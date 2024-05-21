require('dotenv').config();
const { OpenAI } = require("openai");
const fs = require('fs');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function main() {
    try {
        const run = await openai.beta.threads.createAndRun({
            assistant_id: process.env.OPENAI_ASSISTANT_ID,
            thread: {
              messages: [
                { role: "user", content: "Can you tell me about the company 24/7 Teach?" },
              ],
            },
          });

        console.log("run status: ", run.status);

        while(
            await openai.beta.threads.runs.retrieve(
                run.thread_id,
                run.id
              ).status != 'failed'
        ){
            const result = await openai.beta.threads.runs.retrieve(
                run.thread_id,
                run.id
            );
            console.log("Status of run is:" , result.status);

            if(result.status == 'completed'){
                const threadMessages = await openai.beta.threads.messages.list(
                    run.thread_id
                  );

                console.log(threadMessages.data[0].content[0].text.value)
                return threadMessages.data[0].content[0].text.value;
            }
        }
    } catch (error) {
        console.error('An error occurred:', error);
        return "";
    }
}

main();