import { Message } from '@line/bot-sdk';
import { get } from 'lodash';

export class IntentHandler {
    private intentName:string;
    private lineMessages: Message[] = [];

    constructor(sessionClient, req) {
        const res = sessionClient.detectIntent(req);
        const result = get(res, ['0', 'queryResult']);
        this.intentName = get(result, ['intent', 'displayName']);

        switch (this.intentName) {
            case 'voterest - custom - yes':
                const rest_name = get(result, ["outputContexts", "parameters", "rest_name"]);
                const point = get(result, ["outputContexts", "parameters", "point"]);
                console.log(rest_name, point)
                let message: Message;

                message = {
                    type: 'text',
                    text: 'Successfully recorded',
                };
                this.lineMessages.push(message);
                break;
            default:
                console.log('Case no match')
        }
    }

    public getLINEMessage() {
        return this.lineMessages
    }

    public getintentName() {
        return this.intentName;
    }

    private voteRest() {

    }
}