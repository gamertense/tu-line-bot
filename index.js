const express = require('express')
const bodyParser = require('body-parser');
const app = express()
const port = process.env.PORT || 8080;

const firebase = require('./firebase')

const bodyMassIndex = (queryResult, response) => {
    let weight = queryResult.parameters.weight;
    let height = queryResult.parameters.height / 100;
    let bmi = (weight / (height * height)).toFixed(2);

    let result = "none";
    let pkgId = '1';
    let stkId = '1';

    if (bmi < 18.5) {
        pkgId = '11538';
        stkId = '51626519';
        result = 'xs';
    } else if (bmi >= 18.5 && bmi <= 22.9) {
        pkgId = '11537';
        stkId = '52002741';
        result = 's';
    } else if (bmi >= 23 && bmi <= 24.9) {
        pkgId = '11537';
        stkId = '52002745';
        result = 'm';
    } else if (bmi >= 25 && bmi <= 29.9) {
        pkgId = '11537';
        stkId = '52002762';
        result = 'l';
    } else if (bmi > 30) {
        pkgId = '11538';
        stkId = '51626513';
        result = 'xl';
    }

    firebase.database().ref('/bmi/' + result).once('value').then(function (snapshot) {
        let bmi_result = snapshot.val();
        response.send({
            fulfillmentText: [
                {
                    payload: {
                        line: {
                            type: "sticker",
                            packageId: pkgId,
                            stickerId: stkId
                        }
                    }
                }
            ]
        });
    })
}

app.use(bodyParser.json());

app.get('/', (req, res) => {
    // res.send('Hello World!');
    queryResult = { parameters: { weight: 50, height: 165 } }
    bodyMassIndex(queryResult, res);
})

app.post('/webhook', function (request, response) {
    let queryResult = request.body.queryResult;
    console.log(queryResult)
    if (queryResult.intent.displayName === 'BMI - custom - yes') {
        bodyMassIndex(queryResult, response);
    }
})

app.listen(port, () => console.log(`Example app listening on port ${port}!`))