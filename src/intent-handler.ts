import { set, get } from 'lodash';
import {
    Message, FlexMessage, FlexCarousel, FlexBubble
} from '@line/bot-sdk';

import geolib from 'geolib';

// Cloud Firestore and geofirestore
const firestoreDB = require('../firestore/firestore')
import * as firebase from 'firebase/app';
import 'firebase/firestore';
import { GeoFirestore, GeoQuery } from 'geofirestore';

export const getIsIntentMatch = (userid, res) => {
    const queryResult = get(res, ['0', 'queryResult']);
    const intentName = get(queryResult, ['intent', 'displayName']);

    switch (intentName) {
        case 'TU-Places - yes':
            return tuPlace(userid, queryResult)
        case 'Vote restaurant': // User supplied restaurant name, but yet not sore.
            return popularRest('vote') // User supplied name & score.
        case 'Vote restaurant - name - score - yes':
            return voteRest(queryResult)
        case 'Popular restaurant':
            return popularRest('popular')
        case 'Seat type preference':
            return setSeatType(userid, queryResult)
        default:
            return null
    }
}

export const getClosestBusStop = async (userId: string, message) => {
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

        let lineMessages = [`ป้ายรถเมล์ที่ใกล้คุณที่สุดคือ ${busInfo} อยู่ห่างจากคุณ ${(distanceKM * 1000).toFixed(2)} เมตรและคือสาย ${busLine}`];
        lineMessages.push(await findPreDestination(userId, userLocation, busLine));
        lineMessages.push(await checkBusTraffic(busLine));

        return lineMessages;
    }
}

// Check if traffic congestion occurs at bus location
const checkBusTraffic = async (busLine: number[]) => {
    const axios = require('axios');

    // To be done.
    // Get all buses from external API and choose only the closest one.
    const busLocationInfo = 'หอสมุดป๋วย';
    const buslocation = [52.41072, 4.84239];

    try {
        const key = 'WvTNE8QePwDPIDdHK5la74ApPYryjHdH';
        const url = `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point=${buslocation[0]}%2C${buslocation[1]}&key=${key}`;
        const response = await axios.get(url);
        const speed = get(response, ['data', 'flowSegmentData', 'freeFlowSpeed']);

        switch (true) {
            case (speed >= 0 || speed <= 10):
                return `ขณะนี้มีการจราจรติดขัดมาก ${busLocationInfo}`;
            case (speed >= 10 || speed <= 20):
                return `ขณะนี้มีการจราจรติดขัดเล็กน้อยที่ ${busLocationInfo}`;
            case (speed > 30):
                return `ขณะนี้การจราจรปกติ`;
            default:
                return 'TOMTOM gave invalid data.';
        }

    } catch (error) {
        return error;
    }
}

// In a case that user needs to take more than one NGV bus.
const findPreDestination = async (userid: string, userLocation: number[], busLine: string[]) => {
    const userRef = firestoreDB.collection('user').doc(userid);

    try {
        const userDoc = await userRef.get();
        const userBus = get(userDoc.data(), 'busLine[0]')

        if (userDoc.exists && userBus.includes(busLine) === false) {
            const busStopRef = firestoreDB.collection('bus-stops')
            const snapshot = await busStopRef.get()

            if (snapshot.empty) {
                return "No matching documents."
            }

            let min = 100000;
            let preDest = {}

            for (let i in snapshot.docs) {
                const doc = snapshot.docs[i]
                const busSearchDoc = get(doc.data(), 'd.line')
                // Check which bus to take next and where to stop at
                if (busSearchDoc !== undefined && busSearchDoc.includes(busLine[0]) && busSearchDoc.includes(userBus)) {
                    const dist = geolib.getDistance(
                        { latitude: userLocation[0], longitude: userLocation[1] },
                        { latitude: get(doc.data(), 'l._latitude'), longitude: get(doc.data(), 'l._longitude') }
                    );
                    if (dist < min) {
                        min = dist
                        preDest['name'] = get(doc.data(), 'd.info')
                        preDest['line'] = get(doc.data(), 'd.line')
                    }
                }
            };
            return `คุณต้องนั่งรถสาย ${busLine} แล้วไปลงที่ ${preDest['name']} จากนั้นต่อสาย ${preDest['line']} เพื่อไป ${get(userDoc.data(), 'destination')}`
        } else {
            return 'No such user!';
        }
    }
    catch (err) {
        return err;
    };
}

const tuPlace = async (userid, queryResult) => {
    const userDestination = get(queryResult, ['outputContexts', '0', 'parameters', 'fields', 'place', 'stringValue']).toLowerCase();
    console.log('TCL: tuPlace -> userDestination', userDestination)
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
                const userRef = firestoreDB.collection('user').doc(userid);
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

const voteRest = async (queryResult) => {
    const rest_name = get(queryResult, ['outputContexts', '0', 'parameters', 'fields', 'rest_name', 'stringValue']);
    const vote_point = get(queryResult, ['outputContexts', '0', 'parameters', 'fields', 'point', 'numberValue']);

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

const setSeatType = async (userid: string, queryResult: any) => {
    console.log("TCL: setSeatType -> queryResult", JSON.stringify(queryResult));
    const seattype = get(queryResult, ['parameters', 'fields', 'seattype', 'stringValue']);
    const userRef = firestoreDB.collection('user').doc(userid);
    const userDoc = await userRef.get();

    if (userDoc.exists)
        userRef.update({ seattype });
    else
        userRef.set({ seattype });

    let lineMessages: Message[] = [];
    let message: Message = {
        type: 'text',
        text: get(queryResult, ['fulfillmentMessages', '0', 'text', 'text', '0'])
    };
    lineMessages.push(message);
    return lineMessages;
}