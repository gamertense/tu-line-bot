import { set, get } from 'lodash';
import {
    Message, FlexMessage, FlexCarousel, FlexBubble,
    QuickReply, QuickReplyItem, Action
} from '@line/bot-sdk';

// Cloud Firestore and geofirestore
const firestoreDB = require('../firestore/firestore')
import * as firebase from 'firebase/app';
import 'firebase/firestore';
import { GeoFirestore, GeoQuery } from 'geofirestore';

export const getIsIntentMatch = (res) => {
    const queryResult = get(res, ['0', 'queryResult']);
    const intentName = get(queryResult, ['intent', 'displayName']);

    switch (intentName) {
        case 'TU-Places - yes':
            return tuPlace(queryResult)
        case 'Vote restaurant': // User supplied restaurant name, but yet not sore.
            return popularRest('vote') // User supplied name & score.
        case 'Vote restaurant - name - score - yes':
            return voteRest(queryResult)
        case 'Popular restaurant':
            return popularRest('popular')
        default:
            return null
    }
}

export const getClosestBusStop = async (message) => {
    // Create a GeoFirestore reference
    const geofirestore: GeoFirestore = new GeoFirestore(firestoreDB);

    // Create a GeoCollection reference
    const geoCollectionRef = geofirestore.collection('bus-stops');

    // Create a GeoQuery based on a location
    const userLocation = [get(message, ['latitude']), get(message, ['longitude'])]
    const query: GeoQuery = geoCollectionRef.near({ center: new firebase.firestore.GeoPoint(userLocation[0], userLocation[1]), radius: 0.1 });

    // Get the closest bus stop
    const busStop = await query.get();
    // Sort docs since the closest one may be at index 2.
    busStop.docs.sort((a, b) => (a.distance > b.distance) ? 1 : -1)

    const distanceKM = get(busStop.docs, ['0', 'distance'])
    const busStopID = get(busStop.docs, ['0', 'id'])
    const busDocRef = firestoreDB.collection('bus-stops').doc(busStopID)
    const busDoc = await busDocRef.get()

    if (!busDoc.exists) {
        return 'Unable to find the closest bus stop.'
    } else {
        const busInfo = get(busDoc.data(), ['d', 'info'])
        const busLine = get(busDoc.data(), ['d', 'line'])
        return `ป้ายรถเมล์ที่ใกล้คุณที่สุดคือ ${busInfo} อยู่ห่างจากคุณ ${(distanceKM * 1000).toFixed(2)} เมตรและคือสาย ${busLine}`;
    }
}

const tuPlace = async (queryResult) => {
    const queryPlace = get(queryResult, ['outputContexts', '0', 'parameters', 'fields', 'place', 'stringValue']).toLowerCase();
    console.log('TCL: tuPlace -> queryPlace', queryPlace)
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
            if (placeFromDoc.includes(queryPlace)) {
                const qreply = {
                    items: [{
                        type: "action",
                        action: {
                            type: "location",
                            label: "Send location"
                        }
                    }]
                }
                set(message, 'text', `สายรถ NGV ที่ผ่านสถานที่นั้นคือ ${get(doc.data(), 'd.line')} กดปุ่ม Send location ด้านล่างเพื่อหาป้ายที่ใกล้ที่สุดครับ`)
                set(message, "quickReply", qreply)
                lineMessages.push(message);
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

const popularRest = async (action) => {
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
        snapshot.forEach(doc => {
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
        });

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

const voteRest = async (queryResult) => {
    let lineMessages: Message[] = [];
    const rest_name = get(queryResult, ['outputContexts', '0', 'parameters', 'fields', 'rest_name', 'stringValue']);
    const vote_point = get(queryResult, ['outputContexts', '0', 'parameters', 'fields', 'point', 'numberValue']);
    let message: Message; // A LINE response message

    try {
        const restaurantRef = firestoreDB.collection('restaurant');
        const snapshot = await restaurantRef.where('name', '==', rest_name).get()

        if (snapshot.empty) {
            message = {
                type: 'text',
                text: 'Unable to find the restaurant in database!',
            };
            lineMessages.push(message);
            return lineMessages;
        } else {
            snapshot.forEach(async doc => {
                await firestoreDB.runTransaction(async transaction => {
                    const res = await transaction.get(restaurantRef.doc(doc.id));

                    if (!res.exists) {
                        throw "Document does not exist!";
                    }

                    // Compute new number of ratings
                    let newNumRatings = res.data().numRatings + 1;

                    // Compute new average rating
                    let oldRatingTotal = res.data().avgRating * res.data().numRatings;
                    let newAvgRating = (oldRatingTotal + vote_point) / newNumRatings;
                    // Limit to two decimal places
                    newAvgRating = parseFloat(newAvgRating.toFixed(2))

                    // Commit to Firestore
                    transaction.update(restaurantRef.doc(doc.id), {
                        numRatings: newNumRatings,
                        avgRating: newAvgRating
                    });
                })
            });

            message = {
                type: 'text',
                text: 'Your vote is successfully recorded!',
            };
            lineMessages.push(message);
            return lineMessages
        }
    } catch (err) {
        throw new Error(`Error getting document ${err}`);
    }
}