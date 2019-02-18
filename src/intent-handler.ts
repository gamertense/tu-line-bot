import { get } from 'lodash';
import { Message } from '@line/bot-sdk';
const firestoreDB = require('../firestore/firestore')

export const getIsIntentMatch = (res) => {
    const queryResult = get(res, ['0', 'queryResult']);
    const intentName = get(queryResult, ['intent', 'displayName']);
    let lineMessages: Message[] = [];

    switch (intentName) {
        case 'voterest - custom - yes':
            return voteRest(queryResult, lineMessages)
        case 'Popular restaurant':
            return popularRest(lineMessages)
        default:
            return null
    }
}

const popularRest = async (lineMessages) => {
    const resRef = firestoreDB.collection('restaurant');
    const snapshot = await resRef.where('avgRating', '>=', 4).get()

    try {
        if (snapshot.empty) {
            console.log('No matching documents.');
            return;
        }

        snapshot.forEach(doc => {
            let restaurant_template = require('../line_template/restaurant.json');
            let obj = JSON.parse(JSON.stringify(restaurant_template));
            obj.hero.url = doc.data().image_url;
            obj.body.contents[0].text = doc.data().name;
            obj.body.contents[1].contents[5].text = doc.data().avgRating.toString();
            obj.body.contents[2].contents[0].contents[1].text = doc.data().place;
            lineMessages.push(obj);
        });
        return lineMessages
    }

    catch (err) {
        console.log('Error getting documents', err);
    };
}

const voteRest = async (queryResult, lineMessages) => {
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