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

    public async getIsIntentMatch() {
        let isIntentMatch = false;
        switch (this.intentName) {
            case 'voterest - custom - yes':
                isIntentMatch = true;
                await this.voteRest()
                break;
        }

        return isIntentMatch;
    }

    private voteRest() {
        const rest_name = get(this.queryResult, ['outputContexts', '0', 'parameters', 'fields', 'rest_name', 'stringValue']);
        const vote_point = get(this.queryResult, ['outputContexts', '0', 'parameters', 'fields', 'point', 'numberValue']);
        const restaurantRef = firestoreDB.collection('restaurant');

        let linemsg = this.lineMessages

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
                            })
                        }).then(function () {
                            console.log("Transaction successfully committed!");
                            let message: Message;

                            message = {
                                type: 'text',
                                text: 'Successfully recorded',
                            };
                            linemsg.push(message);
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