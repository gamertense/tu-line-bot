const express = require('express')
const bodyParser = require('body-parser');
const app = express()
const port = process.env.PORT || 8080;

const firebase = require('./firebase')

app.use(bodyParser.json());

app.get('/', (req, res) => {
    res.send('Hello World!');
    firebase.database().ref('/bmi/l').once('value').then(function (snapshot) {
        console.log(snapshot.val())
    })
})

app.post('/webhook', function (request, response) {
    console.log(request.body)
    if (request.body.queryResult.intent.displayName === 'top-rated') {
        response.send(JSON.stringify({
            "fulfillmentText": "Error. Can you try it again ? ",
        }));
    }
})

app.listen(port, () => console.log(`Example app listening on port ${port}!`))