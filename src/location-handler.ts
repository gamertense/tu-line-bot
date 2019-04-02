import { Message } from '@line/bot-sdk';
import { get, set } from 'lodash';

import geolib from 'geolib';
// Cloud Firestore and geofirestore
const firestoreDB = require('../firestore/firestore')
import * as firebase from 'firebase/app';
import 'firebase/firestore';
import { GeoFirestore, GeoQuery } from 'geofirestore';

export class LocationHandler {
    private readonly userId: string;
    private readonly locationMessage: any;
    private busLine: string[] = [];
    private userDoc: any;

    constructor(userId: string, locationMessage: any) {
        this.userId = userId;
        this.locationMessage = locationMessage;
    }

    public getClosestBusStop = async () => {
        this.userDoc = await firestoreDB.collection('user')
            .doc(this.userId)
            .get();

        // Create a GeoFirestore reference
        const geofirestore: GeoFirestore = new GeoFirestore(firestoreDB);

        // Create a GeoCollection reference
        const geoCollectionRef = geofirestore.collection('bus-stops');

        // Create a GeoQuery based on a location
        const userLocation = [get(this.locationMessage, ['latitude']), get(this.locationMessage, ['longitude'])]
        const query: GeoQuery = geoCollectionRef.near({ center: new firebase.firestore.GeoPoint(userLocation[0], userLocation[1]), radius: 0.1 });

        // Get the closest bus stop
        const busStop = await query.get();
        // Sort docs since the closest one may be at index 2.
        busStop.docs.sort((a, b) => (a.distance > b.distance) ? 1 : -1);

        const distanceKM = get(busStop.docs, ['0', 'distance']);
        const busStopID = get(busStop.docs, ['0', 'id']);
        const busDocRef = firestoreDB.collection('bus-stops').doc(busStopID);
        const busDoc = await busDocRef.get();

        let lineMessages: Message[] = [];
        let message: Message = {
            type: 'text',
            text: 'Unable to find the closest bus stop.',
        };

        if (!busDoc.exists) {
            lineMessages.push(message);
            return message;
        } else {
            const busInfo = get(busDoc.data(), ['d', 'info']);
            this.busLine = get(busDoc.data(), ['d', 'line']);
            let coordinates = get(busDoc.data(), ['d', 'coordinates']);

            message = {
                type: 'text',
                text: `ป้ายรถเมล์ที่ใกล้คุณที่สุดคือ ${busInfo} อยู่ห่างจากคุณ ${(distanceKM * 1000).toFixed(2)} เมตรและคือสาย ${this.busLine}`
            };
            lineMessages.push(message);

            //Push if the user has to take > 1 buses
            const preBusMsg = await this.findPreDestination(userLocation);
            if (preBusMsg) {
                message = {
                    type: 'text',
                    text: preBusMsg.text
                };

                lineMessages.push(message);
                coordinates = preBusMsg.coor;
            }

            message = {
                type: 'text',
                text: await this.checkBusTraffic(),
            };
            lineMessages.push(message);

            // Add button
            let contentObj = JSON.parse(JSON.stringify(require('../line_template/mapButton.json')));
            set(contentObj, 'contents.body.contents[0].action.uri', `http://www.google.com/maps/place/${get(coordinates, '_latitude')},${get(coordinates, '_longitude')}`)
            lineMessages.push(contentObj);

            return lineMessages;
        }
    }

    // Check if traffic congestion occurs at bus location
    private checkBusTraffic = async () => {
        const axios = require('axios');

        // To be done.
        // Get all buses from external API and choose only the closest one.
        const busLocationInfo = 'หอสมุดป๋วย';
        const buslocation = [14.06658289, 100.60509235];

        try {
            const key = 'WvTNE8QePwDPIDdHK5la74ApPYryjHdH';
            const url = `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point=${buslocation[0]}%2C${buslocation[1]}&key=${key}`;
            const response = await axios.get(url);
            const speed = get(response, ['data', 'flowSegmentData', 'currentSpeed']);

            switch (true) {
                case speed <= 10:
                    return `ขณะนี้มีการจราจรติดขัดมากที่ ${busLocationInfo}`;
                case speed <= 20:
                    return `ขณะนี้มีการจราจรติดขัดเล็กน้อยที่ ${busLocationInfo}`;
                default:
                    return `ขณะนี้การจราจรปกติ`;
            }

        } catch (error) {
            console.log(error);
            return error;
        }
    }

    // In a case that user needs to take more than one NGV bus.
    private findPreDestination = async (userLocation: number[]) => {
        try {
            //The last bus the user needs to take to go to his/her destination.
            const lastTakeBus = get(this.userDoc.data(), 'busLine[0]')

            if (this.userDoc.exists && this.busLine.includes(lastTakeBus) === false) {
                const busStopRef = firestoreDB.collection('bus-stops')
                const snapshot = await busStopRef.get()

                if (snapshot.empty) {
                    console.log("No matching documents.");
                }

                let min = 100000;
                let preDest = {}

                for (let i in snapshot.docs) {
                    const doc = snapshot.docs[i]
                    const busSearchDoc = get(doc.data(), 'd.line')
                    // Check which bus to take next and where to stop at
                    if (busSearchDoc !== undefined && busSearchDoc.includes(this.busLine[0]) && busSearchDoc.includes(lastTakeBus)) {
                        const dist = geolib.getDistance(
                            { latitude: userLocation[0], longitude: userLocation[1] },
                            { latitude: get(doc.data(), 'l._latitude'), longitude: get(doc.data(), 'l._longitude') }
                        );
                        if (dist < min) {
                            min = dist
                            preDest['name'] = get(doc.data(), 'd.info')
                            preDest['line'] = get(doc.data(), 'd.line')
                            preDest['coor'] = get(doc.data(), 'd.coordinates')
                        }
                    }
                };

                const preTakeBus = preDest['line'].filter(line => this.busLine[0] !== line);

                return {
                    text: `คุณต้องนั่งรถสาย ${this.busLine} แล้วไปลงที่ ${preDest['name']} จากนั้นต่อสาย ${preTakeBus} เพื่อไป ${get(this.userDoc.data(), 'destination')}`,
                    coor: preDest['coor'],
                }
            }
            return;
        }
        catch (err) {
            console.log(err);
            return;
        };
    }
};