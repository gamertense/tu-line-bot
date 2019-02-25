import { set, get } from 'lodash';
import { Message, FlexMessage, FlexCarousel, FlexBubble } from '@line/bot-sdk';

// Cloud Firestore and geofirestore
const firestoreDB = require('../firestore/firestore')
import * as firebase from 'firebase/app';
import 'firebase/firestore';
import { GeoFirestore, GeoQuery } from 'geofirestore';

export const getIsIntentMatch = (res) => {
    const queryResult = get(res, ['0', 'queryResult']);
    const intentName = get(queryResult, ['intent', 'displayName']);
    let lineMessages: Message[] = [];

    switch (intentName) {
        case 'Vote restaurant':
            return popularRest(lineMessages, 'vote')
        case 'Vote restaurant - yes':
            return voteRest(queryResult, lineMessages)
        case 'Popular restaurant':
            return popularRest(lineMessages, 'popular')
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

    const busStop = await query.get();
    busStop.docs.sort((a, b) => (a.distance > b.distance) ? 1 : -1)
    const distance = get(busStop.docs, ['0', 'distance'])
    const busStopID = get(busStop.docs, ['0', 'id'])
    console.log('TCL: getBusStop -> busStopID', busStopID)

    const fs = require('fs');
    fs.writeFileSync('./myjsonfile.json', JSON.stringify(busStop.docs));

    const busDocRef = firestoreDB.collection('bus-stops').doc(busStopID)
    const busDoc = await busDocRef.get()

    if (!busDoc.exists) {
        console.log('No such document!');
    } else {
        const busInfo = get(busDoc.data(), ['d', 'info'])
        const busLine = get(busDoc.data(), ['d', 'line'])
        console.log(`ป้ายรถเมล์ที่ใกล้คุณที่สุดคือ ${busInfo} อยู่ห่างจากคุณ ${distance} เมตรและคือสาย ${busLine}`);
    }
}

const popularRest = async (lineMessages, action) => {
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
            contentObj.hero.url = doc.data().image_url;
            contentObj.body.contents[0].text = doc.data().name;
            contentObj.body.contents[1].contents[5].text = doc.data().avgRating.toString();
            contentObj.body.contents[2].contents[0].contents[1].text = doc.data().place;

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

const voteRest = async (queryResult, lineMessages) => {
    console.log('TCL: voteRest -> queryResult', get(queryResult, ['outputContexts', '0']));
    const rest_name = get(queryResult, ['outputContexts', '0', 'parameters', 'fields', 'rest_name', 'stringValue']);
    const vote_point = get(queryResult, ['outputContexts', '0', 'parameters', 'fields', 'point', 'numberValue']);

    try {
        const restaurantRef = firestoreDB.collection('restaurant');
        const snapshot = await restaurantRef.where('name', '==', rest_name).get()

        if (snapshot.empty) {
            return 'No matching documents.';
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
            let message: Message;
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