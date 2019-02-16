import { Message } from '@line/bot-sdk';
import { get } from 'lodash';

export class IntentHandler {
    private intentName: string = '';
    private isIntentMatch: boolean = false
    private lineMessages: Message[] = [];

    constructor(res) {
        const result = get(res, ['0', 'queryResult']);
        this.intentName = get(result, ['intent', 'displayName']);
        console.log(this.intentName)

        switch (this.intentName) {
            case 'voterest - custom - yes':
                this.isIntentMatch = true;
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

    public getIsIntentMatch() {
        return this.isIntentMatch;
    }

    private voteRest() {

    }
}