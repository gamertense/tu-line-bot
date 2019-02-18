import { Message } from '@line/bot-sdk';
const firestoreDB = require('../firestore/firestore')

export const getIsIntentMatch = (intentName: string) => {
    switch (intentName) {
        case 'voterest - custom - yes':
            return voteRest()
        default:
            return null
    }
}

const voteRest = async () => {
    const rest_name = 'Hotto Bun';
    const vote_point = 4.3;

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
            let lineMessages: Message[] = [];
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