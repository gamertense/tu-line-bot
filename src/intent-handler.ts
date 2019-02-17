import { Message } from '@line/bot-sdk';
import { get } from 'lodash';

const firestoreDB = require('../firestore/firestore')

export class IntentHandler {
    private intentName: string = '';
    private lineMessages: Message[] = [];
    private queryResult

    constructor(res) {
        this.queryResult = get(res, ['0', 'queryResult']);
        this.intentName = get(this.queryResult, ['intent', 'displayName']);
    }

    public getLINEMessage() {
        return this.lineMessages
    }

    public getIsIntentMatch() {
        let isIntentMatch = false;
        switch (this.intentName) {
            case 'voterest - custom - yes':
                isIntentMatch = true;
                this.voteRest()
                break;
        }

        console.log(`match ${isIntentMatch}`)
        return isIntentMatch;
    }

    private async voteRest() {
        const rest_name = get(this.queryResult, ['outputContexts', '0', 'parameters', 'fields', 'rest_name', 'stringValue']);
        const vote_point = get(this.queryResult, ['outputContexts', '0', 'parameters', 'fields', 'point', 'numberValue']);

        try {
            const restaurantRef = firestoreDB.collection('restaurant');
            const snapshot = await restaurantRef.where('name', '==', rest_name).get()

            if (snapshot.empty) {
                console.log('No matching documents.');
            } else {
                snapshot.forEach(async doc => {
                    await firestoreDB.runTransaction(async transaction => {
                        const res = await transaction.get(restaurantRef.doc(doc.id));

                        if (!res.exists) {
                            throw "Document does not exist!";
                        }

                        // Compute new number of ratings
                        let newNumRatings = res.data().numRatings + 1;
                        console.log(newNumRatings)

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

                        let message: Message;
                        message = {
                            type: 'text',
                            text: 'Your vote is successfully recorded!',
                        };
                        this.lineMessages.push(message);
                    })
                });
            }
        } catch (err) {
            console.log('Error getting document', err);
        }
    }
}