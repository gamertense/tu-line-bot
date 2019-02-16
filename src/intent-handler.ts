import { Message } from '@line/bot-sdk';

export class IntentHandler {
    private isIntentMatch = false
    private lineMessages: Message[] = [];

    constructor(intentName: string) {
        switch (intentName) {
            case 'voterest - custom - yes':
                this.isIntentMatch = true;

                let message: Message;

                message = {
                    type: 'text',
                    text: 'Successfully recorded',
                  };
                this.lineMessages.push(message);
                break;
            default:
                this.isIntentMatch = false;
        }
    }

    public getLINEMessage() {
        return this.lineMessages
    }

    public getIsIntentMatch() {
        return this.isIntentMatch;
    }
}