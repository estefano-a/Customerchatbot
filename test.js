require('dotenv').config();
const { OpenAI } = require("openai");
const fs = require('fs');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function main() {
    try {
        const myAssistant = await retryWithExponentialBackoff(async () => {
            return await openai.beta.assistants.retrieve(
                process.env.OPENAI_ASSISTANT_ID
            );
        });

        const thread = await retryWithExponentialBackoff(async () => {
            return await openai.beta.threads.create();
        });

        const message = await retryWithExponentialBackoff(async () => {
            return await openai.beta.threads.messages.create(
                thread.id,
                {
                    role: "user",
                    content: "Hello how are you?",
                }
            );
        });

        const run = await retryWithExponentialBackoff(async () => {
            return await openai.beta.threads.runs.createAndPoll(
                thread.id,
                { 
                    assistant_id: myAssistant.id,
                    instructions: "You are a friend to the user"
                }
            );
        });

        console.log(run);

        // if (run.status === 'completed') {
        //     const messages = await retryWithExponentialBackoff(async () => {
        //         return await openai.beta.threads.messages.list(
        //             run.thread_id
        //         );
        //     });
        //     for (const message of messages.data.reverse()) {
        //         console.log(`${message.role} > ${message.content[0].text.value}`);
        //     }
        // } else {
        //     console.error('Run failed with status:', run);
        // }
    } catch (error) {
        console.error('An error occurred:', error);
    }
}

async function retryWithExponentialBackoff(fn, retries = 5, delay = 1000) {
    try {
        return await fn();
    } catch (error) {
        if (retries <= 0 || (error.status !== 429 && error.code !== 'rate_limit_exceeded')) {
            throw error;
        }
        console.warn(`Rate limit exceeded. Retrying in ${delay}ms... (${retries} retries left)`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return retryWithExponentialBackoff(fn, retries - 1, delay * 2);
    }
}


// async function updateAssistant(){
//     const myUpdatedAssistant = await openai.beta.assistants.update(
//         process.env.OPENAI_ASSISTANT_ID,
//         {
//           model: "gpt-3.5-turbo-0125"
//         });

//         const myAssistant = await openai.beta.assistants.retrieve(
//             process.env.OPENAI_ASSISTANT_ID
//           );

//         console.log(myAssistant);
// }

main();

// async function test(){
//     const completion = await openai.chat.completions.create({
//         messages: [{ role: "system", content: "You are a helpful assistant." }],
//         model: "gpt-3.5-turbo-16k",
//         max_tokens: 300
//       });
    
//       console.log(completion.choices[0]);
// }

// test();