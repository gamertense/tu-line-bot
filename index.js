const express = require('express')
const bodyParser = require('body-parser');
const app = express()
const port = process.env.PORT || 8080;

const firestoreDB = require('./firestore/firestore')

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

    firestoreDB.collection('bmi').doc(result).get()
        .then(doc => {
            if (!doc.exists) {
                console.log('No such document!');
            } else {
                console.log(doc.id, '=>', doc.data());
                response.send({
                    "fulfillmentText": doc.data().description
                });
            }
        })
        .catch(err => {
            console.log('Error getting document', err);
        });
}

const popularRest = (res) => {
    let restaurant_template = require('./restaurant.json');
    let res_list = []

    var resRef = firestoreDB.collection('restaurants');
    // Create a query against the collection
    resRef.where('rating', '>=', 4).get()
        .then(snapshot => {
            if (snapshot.empty) {
                console.log('No matching documents.');
                return;
            }

            snapshot.forEach(doc => {
                let obj = JSON.parse(JSON.stringify(restaurant_template));
                obj.hero.url = doc.data().image_url;
                obj.body.contents[0].text = doc.data().name;
                obj.body.contents[1].contents[5].text = doc.data().rating.toString();
                obj.body.contents[2].contents[0].contents[1].text = doc.data().place;
                res_list.push(obj)
            });
            res.send({
                fulfillmentMessages: {
                    "type": "carousel",
                    "contents": res_list
                }
            })
        })
        .catch(err => {
            console.log('Error getting documents', err);
        });
}

app.use(bodyParser.json());

app.get('/', (req, res) => {
    // queryResult = { parameters: { weight: 50, height: 165 } }
    // bodyMassIndex(queryResult, res);
    popularRest(res);
})

app.post('/webhook', function (request, response) {
    let queryResult = request.body.queryResult;
    console.log(queryResult)
    switch (queryResult.intent.displayName) {
        case 'Popular restaurant':
            console.log(request.body.originalDetectIntentRequest.payload.data)
            popularRest(response);
            break;
        case 'BMI - custom - yes':
            bodyMassIndex(queryResult, response);
            break;
        default:
            console.log("Case no match")
    }
})

app.listen(port, () => console.log(`Example app listening on port ${port}!`))