const admin = require('firebase-admin');

var serviceAccount = require('./tu-bot-serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

var db = admin.firestore();

module.exports = db;