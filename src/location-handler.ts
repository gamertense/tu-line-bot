import { Message } from '@line/bot-sdk';
import { get, set } from 'lodash';
const axios = require('axios');

import geolib from 'geolib';
// Cloud Firestore and geofirestore
const firestoreDB = require('../firestore/firestore')
import * as firebase from 'firebase/app';
import 'firebase/firestore';
import { GeoFirestore, GeoQuery } from 'geofirestore';

import { TRAFFIC_KEY, ROUTE_KEY, BUS_LOCATION_URL, BUS_LOCATION_DATA, MAP_URL } from './assets/api';

const busMapping = require('./assets/busLineMatching.json')

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
        try {
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
            const busStopDoc = await busDocRef.get();

            let lineMessages: Message[] = [];
            let message: Message = {
                type: 'text',
                text: 'Unable to find the closest bus stop.',
            };

            if (!busStopDoc.exists) {
                lineMessages.push(message);
                return message;
            } else {
                const busInfo = get(busStopDoc.data(), ['d', 'info']);
                this.busLine = get(busStopDoc.data(), ['d', 'line']);
                let coordinates = get(busStopDoc.data(), ['d', 'coordinates']);
                let contentObj = require('./assets/line_template/journey_summary.json');

                //Traffic status
                const traffic = await this.checkBusTraffic(userLocation)
                if (traffic.errMsg) {
                    message = {
                        type: 'text',
                        text: traffic.errMsg
                    }
                    lineMessages.push(message);
                    return message;
                }
                set(contentObj, 'contents.body.contents[4].contents[2].contents[1].text', traffic.timeInMin)
                set(contentObj, 'contents.body.contents[4].contents[5].contents[1].text', traffic.trafficStatus)

                set(contentObj, 'contents.body.contents[1].text', get(this.userDoc.data(), 'destination'))
                set(contentObj, 'contents.body.contents[2].text', 'สายรถที่ผ่านคือ 1A 1B 3') //Not finish
                set(contentObj, 'contents.body.contents[4].contents[0].contents[1].text', `${(distanceKM * 1000).toFixed(2)} เมตร`)
                set(contentObj, 'contents.body.contents[4].contents[1].contents[1].text', `${this.busLine}`)
                //Button
                set(contentObj, 'contents.body.contents[4].contents[3].contents[0].action.uri', `${MAP_URL}/?origin=${userLocation[0]},${userLocation[1]}`)

                // message = {
                //     type: 'text',
                //     text: `ป้ายรถเมล์ที่ใกล้คุณที่สุดคือ ${busInfo} อยู่ห่างจากคุณ ${(distanceKM * 1000).toFixed(2)} เมตรและคือสาย ${this.busLine}`
                // };
                // lineMessages.push(message);

                // //Push if the user has to take > 1 buses
                // const preBusMsg = await this.findPreDestination(userLocation);
                // if (preBusMsg) {
                //     message = {
                //         type: 'text',
                //         text: preBusMsg.text
                //     };

                //     lineMessages.push(message);
                //     coordinates = preBusMsg.coor;
                // }

                // message = {
                //     type: 'text',
                //     text: await this.checkBusTraffic(userLocation),
                // };
                // lineMessages.push(message);

                // // Add button
                // let contentObj = JSON.parse(JSON.stringify(require('./assets/line_template/mapButton.json')));
                // set(contentObj, 'contents.body.contents[0].action.uri', `http://www.google.com/maps/place/${get(coordinates, '_latitude')},${get(coordinates, '_longitude')}`)
                lineMessages.push(contentObj);

                return lineMessages;
            }
        } catch (err) {
            console.log(`Error occurred in getClosestBusStop function\n${err}`)
        }
    }

    // Check if traffic congestion occurs at bus location
    private checkBusTraffic = async (userLocation: number[]) => {
        try {
            const fnb = await this.findNearestBus(userLocation);

            if (typeof fnb !== 'object')
                return { errMsg: 'An error has occurred when finding the nearest bus.' }
            if (fnb.lat === undefined)
                return { errMsg: 'ขอโทษครับ ขณะนี้ไม่มีรถ NGV ที่ผ่านจุดที่คุณอยู่' }

            const url = `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point=${fnb.lat}%2C${fnb.lon}&key=${TRAFFIC_KEY}`;
            const response = await axios.get(url);
            const speed = get(response, ['data', 'flowSegmentData', 'currentSpeed']);

            switch (true) {
                case speed <= 10:
                    return { trafficStatus: `ติดขัดมาก`, timeInMin: `${fnb.time + 5} นาที` };
                case speed <= 20:
                    return { trafficStatus: `ติดขัดเล็กน้อย`, timeInMin: `${fnb.time + 3} นาที` };
                default:
                    return { trafficStatus: 'ปกติ', timeInMin: `${fnb.time} นาที` }
            }

        } catch (error) {
            console.log(error);
            return error;
        }
    }

    private findNearestBus = async (userLocation: number[]) => {
        try {
            const allBuses = await axios.post(BUS_LOCATION_URL, BUS_LOCATION_DATA);

            let minDistance = 50;
            let minTravelTime = 60;
            let latlon: number[] = [];

            for (let bus of allBuses.data) {
                if (this.busLine[0] === get(busMapping, bus.carno)) {
                    const tomtomURL = `https://api.tomtom.com/routing/1/calculateRoute/${bus.lat},${bus.lon}:${userLocation[0]},${userLocation[1]}/json?avoid=unpavedRoads&key=${ROUTE_KEY}`;
                    const tomtomRes = await axios.get(tomtomURL);
                    const distance = get(tomtomRes, ['data', 'routes', '0', 'summary', 'lengthInMeters']) / 1000;
                    const travelTimeInMin = get(tomtomRes, ['data', 'routes', '0', 'summary', 'travelTimeInSeconds']) / 60;

                    if (distance < minDistance) {
                        minDistance = distance;
                        minTravelTime = travelTimeInMin;
                        latlon[0] = bus.lat;
                        latlon[1] = bus.lon;
                    }
                }
            }

            return {
                time: minTravelTime.toFixed(0) + ' นาที',
                lat: latlon[0],
                lon: latlon[1]
            }
        } catch (error) {
            console.log(`Unable to find the nearest bus.\n${error}`);
            return 'Unable to find the nearest bus.';
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