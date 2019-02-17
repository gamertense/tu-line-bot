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

    private async voteRest() {
        const rest_name = 'Hotto Bun';
        const vote_point = 4.3;

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
                    })
                });
            }
        } catch (err) {
            console.log('Error getting document', err);
        }
    }
}