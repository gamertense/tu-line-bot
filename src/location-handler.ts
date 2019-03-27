import { get } from 'lodash';

import geolib from 'geolib';
// Cloud Firestore and geofirestore
const firestoreDB = require('../firestore/firestore')
import * as firebase from 'firebase/app';
import 'firebase/firestore';
import { GeoFirestore, GeoQuery } from 'geofirestore';

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
        case speed <= 10:
          return `ขณะนี้มีการจราจรติดขัดมาก ${busLocationInfo}`;
        case speed <= 20:
          return `ขณะนี้มีการจราจรติดขัดเล็กน้อยที่ ${busLocationInfo}`;
        default:
          return `ขณะนี้การจราจรปกติ`;
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
      //The last bus the user needs to take to go to his/her destination.
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

        const bus2 = preDest['line'].filter(line => busLine !== line);
        return `คุณต้องนั่งรถสาย ${busLine} แล้วไปลงที่ ${preDest['name']} จากนั้นต่อสาย ${bus2} เพื่อไป ${get(userDoc.data(), 'destination')}`
      } else {
        return 'No such user!';
      }
    }
    catch (err) {
      return err;
    };
  }