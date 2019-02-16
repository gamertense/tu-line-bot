import { Message } from '@line/bot-sdk';
import { get } from 'lodash';

const firestoreDB = require('../firestore/firestore')

export class IntentHandler {
    private intentName: string = '';
    private isIntentMatch: boolean = false
    private lineMessages: Message[] = [];

    constructor(res) {
        const result = get(res, ['0', 'queryResult']);
        this.intentName = get(result, ['intent', 'displayName']);
        console.log(get(result, ['outputContexts', '0', 'parameters']))

        switch (this.intentName) {
            case 'voterest - custom - yes':
                this.isIntentMatch = true;
                this.voteRest(result)
                break;
            default:
                console.log('Case no match')
        }
    }

    public getLINEMessage() {
        return this.lineMessages
    }

    public getIsIntentMatch() {
        return this.isIntentMatch;
    }

    private voteRest(result) {
        const rest_name = get(result, ['outputContexts', '0', 'parameters', 'fields', 'rest_name', 'stringValue']);
        const vote_point = get(result, ['outputContexts', '0', 'parameters', 'fields', 'point', 'numberValue']);
        const restaurantRef = firestoreDB.collection('restaurant');
        console.log(rest_name, vote_point)

        restaurantRef.where('name', '==', rest_name).get()
            .then(snapshot => {
                if (snapshot.empty) {
                    console.log('No matching documents.');
                } else {
                    snapshot.forEach(doc => {
                        return firestoreDB.runTransaction(transaction => {
                            return transaction.get(restaurantRef.doc(doc.id)).then(res => {
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

                                let message: Message;

                                message = {
                                    type: 'text',
                                    text: 'Successfully recorded',
                                };
                                this.lineMessages.push(message);
                            })
                        }).then(function () {
                            console.log("Transaction successfully committed!");
                        }).catch(function (error) {
                            console.log("Transaction failed: ", error);
                        });
                    });
                }
            })
            .catch(err => {
                console.log('Error getting document', err);
            });
    }
}