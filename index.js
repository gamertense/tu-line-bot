const express = require('express')
const bodyParser = require('body-parser');
const app = express()
const port = process.env.PORT || 8080;

const firebase = require('./firebase')

const bodyMassIndex = (queryResult) => {
    let weight = queryResult.parameters.weight;
    let height = queryResult.parameters.height / 100;
    let bmi = (weight / (height * height)).toFixed(2);
    let bmi_result = "none";

    if (bmi < 18.5) {
        bmi_result = "xs";
    } else if (bmi >= 18.5 && bmi <= 22.9) {
        bmi_result = "s";
    } else if (bmi >= 23 && bmi <= 24.9) {
        bmi_result = "m";
    } else if (bmi >= 25 && bmi <= 29.9) {
        bmi_result = "l";
    } else if (bmi > 30) {
        bmi_result = "xl";
    }

    firebase.database().ref('/bmi/' + bmi_result).once('value').then(function (snapshot) {
        return snapshot.val().description;
    })
}

app.use(bodyParser.json());

app.get('/', (req, res) => {
    res.send('Hello World!');
})

app.post('/webhook', function (request, response) {
    let queryResult = request.body.queryResult;
    console.log(queryResult)
    if (queryResult.intent.displayName === 'BMI') {
        response.send(JSON.stringify({
            "fulfillmentText": bodyMassIndex(queryResult)
        }));
    }
})

app.listen(port, () => console.log(`Example app listening on port ${port}!`))