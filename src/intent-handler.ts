import { set, get } from 'lodash';
import {
    Message, FlexMessage, FlexCarousel, FlexBubble
} from '@line/bot-sdk';

// Cloud Firestore and geofirestore
const firestoreDB = require('../firestore/firestore');

export class IntentHandler {
    private readonly userid: string;
    private readonly queryResult: any;

    constructor(userid: string, res: any) {
        this.userid = userid;
        this.queryResult = get(res, ['0', 'queryResult']);
    }

    private isIntentMatched = () => {
        const intentName = get(this.queryResult, ['intent', 'displayName']);

        switch (intentName) {
            case 'TU-Places - yes':
                return this.tuPlace();
            case 'Vote restaurant': // User supplied restaurant name, but yet not sore.
                return this.popularRest('vote'); // User supplied name & score.
            case 'Vote restaurant - name - score - yes':
                return this.voteRest();
            case 'Popular restaurant':
                return this.popularRest('popular')
            case 'Seat type preference':
                return this.setSeatType();
            default:
                return null
        }
    }

    private tuPlace = async () => {
        const userDestination = get(this.queryResult, ['outputContexts', '0', 'parameters', 'fields', 'place', 'stringValue']).toLowerCase();
        const placeRef = firestoreDB.collection('places');
        const snapshot = await placeRef.get();
        let lineMessages: Message[] = [];
        let message: Message = {
            type: 'text',
            text: 'No docs in collection.',
        };
        try {
            if (snapshot.empty) {
                lineMessages.push(message);
                return lineMessages
            }

            for (let i in snapshot.docs) {
                const doc = snapshot.docs[i]
                const placeFromDoc = get(doc.data(), 'd.name').toLowerCase();
                if (placeFromDoc.includes(userDestination)) {
                    const qreply = {
                        items: [{
                            type: "action",
                            action: {
                                type: "location",
                                label: "Send location"
                            }
                        }]
                    }
                    set(message, 'text', `สายรถ NGV ที่ผ่าน ${userDestination} คือ ${get(doc.data(), 'd.line')} กดปุ่ม Send location ด้านล่างเพื่อหาป้ายที่ใกล้ที่สุดครับ`)
                    set(message, "quickReply", qreply)
                    lineMessages.push(message);

                    //Add user destination and bus lines for future search
                    const userRef = firestoreDB.collection('user').doc(this.userid);
                    const userDoc = userRef.get();
                    if (userDoc.exists)
                        userRef.update({ destination: userDestination, busLine: get(doc.data(), 'd.line') });
                    else
                        userRef.set({ destination: userDestination, busLine: get(doc.data(), 'd.line') });

                    break
                }
            }

            if (lineMessages.length === 0) {
                set(message, 'text', 'Unable to find that place')
                lineMessages.push(message);
            }
            return lineMessages

        } catch (err) {
            set(message, 'text', err.message)
            lineMessages.push(message);
            return lineMessages
        }
    }

    private popularRest = async (action) => {
        let lineMessages: Message[] = [];
        const resRef = firestoreDB.collection('restaurant');
        let snapshot;
        if (action === 'vote')
            snapshot = await resRef.get();
        else
            snapshot = await resRef.where('avgRating', '>=', 4).get()

        try {
            if (snapshot.empty) {
                let message: Message;
                message = {
                    type: 'text',
                    text: 'Unable to find documents which have avgRating >= 4',
                };
                lineMessages.push(message);
                return lineMessages
            }

            let contentsArray: FlexBubble[] = [];

            for (let i in snapshot.docs) {
                const doc = snapshot.docs[i]
                let contentObj = JSON.parse(JSON.stringify(require('../line_template/restaurant.json')));

                set(contentObj, 'hero.url', doc.data().image_url)
                set(contentObj, 'body.contents[0].text', doc.data().name)
                set(contentObj, 'body.contents[1].contents[5].text', doc.data().avgRating.toString())
                set(contentObj, 'body.contents[2].contents[0].contents[1].text', doc.data().place)

                if (action === 'vote') {
                    set(contentObj, 'footer.contents[0].action.label', 'Vote')
                    set(contentObj, 'footer.contents[0].action.text', `โหวต ${doc.data().name}`)
                }
                contentsArray.push(contentObj)
            }

            const carouselMsg: FlexCarousel = { type: "carousel", contents: contentsArray };
            const flexMsg: FlexMessage = {
                "type": "flex",
                "altText": "This is a Flex Message",
                "contents": carouselMsg
            }
            lineMessages.push(flexMsg)
            return lineMessages;
        }

        catch (err) {
            let message: Message;
            message = {
                type: 'text',
                text: 'Error getting documents',
            };
            lineMessages.push(message);
            return lineMessages
        };
    }

    private voteRest = async () => {
        const rest_name = get(this.queryResult, ['outputContexts', '0', 'parameters', 'fields', 'rest_name', 'stringValue']);
        const vote_point = get(this.queryResult, ['outputContexts', '0', 'parameters', 'fields', 'point', 'numberValue']);

        let lineMessages: Message[] = [];
        let message: Message = {
            type: 'text',
            text: 'Your vote is successfully recorded!',
        }; // A LINE response message

        try {
            const restaurantRef = firestoreDB.collection('restaurant');
            const snapshot = await restaurantRef.where('name', '==', rest_name).get()
            const resToUpdateRef = restaurantRef.doc(snapshot.docs[0].id)

            return await firestoreDB.runTransaction(async transaction => {
                const doc = await transaction.get(resToUpdateRef);
                if (!doc.exists) {
                    set(message, 'text', `Unable to find restaurant in database with id ${snapshot.docs[0].id}`)
                    lineMessages.push(message);
                    return lineMessages
                }
                // Compute new number of ratings
                let newNumRatings = doc.data().numRatings + 1;

                // Compute new average rating
                let oldRatingTotal = doc.data().avgRating * doc.data().numRatings;
                let newAvgRating = (oldRatingTotal + vote_point) / newNumRatings;
                // Limit to two decimal places
                newAvgRating = parseFloat(newAvgRating.toFixed(2))

                // Commit to Firestore
                transaction.update(resToUpdateRef, {
                    numRatings: newNumRatings,
                    avgRating: newAvgRating
                });

                lineMessages.push(message);
                return lineMessages

            })
        } catch (e) {
            console.log('Vote failed', e);
            set(message, 'text', 'An error has occurred! Vote failed.')
            lineMessages.push(message);
            return lineMessages
        }
    }

    private setSeatType = async () => {
        console.log("TCL: setSeatType -> queryResult", JSON.stringify(this.queryResult));
        const seattype = get(this.queryResult, ['parameters', 'fields', 'seattype', 'stringValue']);
        const userRef = firestoreDB.collection('user').doc(this.userid);
        const userDoc = await userRef.get();

        if (userDoc.exists)
            userRef.update({ seattype });
        else
            userRef.set({ seattype });

        let lineMessages: Message[] = [];
        let message: Message = {
            type: 'text',
            text: get(this.queryResult, ['fulfillmentMessages', '0', 'text', 'text', '0'])
        };
        lineMessages.push(message);
        return lineMessages;
    }
}