var firebase = require("firebase");

var config = {
  apiKey: "AIzaSyDx7D7l40ET8WqGBnosUkUkWvlJODAG98M",
  authDomain: "tu-line-bot.firebaseapp.com",
  databaseURL: "https://tu-line-bot.firebaseio.com",
  projectId: "tu-line-bot",
  storageBucket: "tu-line-bot.appspot.com",
  messagingSenderId: "35543680535"
};
firebase.initializeApp(config);

module.exports = firebase 