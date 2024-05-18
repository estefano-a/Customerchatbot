require('dotenv').config();
const { OpenAI } = require("openai");
const fs = require('fs');
const openai = new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] });

const vectorid = "vs_zT8nG2GRK8kQfA2msof06e84";
const threadid = "thread_hPlZRpDJA4H38gA5bSCuUyIr";

//reading files
const schemaFile = "chatgptSchema.txt";
const systemSchema = fs.readFileSync(schemaFile, "utf-8");

async function main() {
    try {
        const myAssistant = await openai.beta.assistants.retrieve(
            process.env.OPENAI_ASSISTANT_ID
        );

        const thread = await openai.beta.threads.create();
        const message = await openai.beta.threads.messages.create(
            thread.id,
            {
                role: "user",
                content: "Hello how are you?",
            }
        );
        let run = await openai.beta.threads.runs.createAndPoll(
            thread.id,
            { 
                assistant_id: myAssistant.id,
                instructions: "You are a friend to the user"
            }
        );
        console.log(run);
    } catch (error) {
        console.error('An error occurred:', error);
    }
}

async function retryWithExponentialBackoff(fn, retries = 5, delay = 1000) {
    try {
        const result = await fn();
        if (result.status !== 'completed') {
            throw new Error('Run did not complete successfully');
        }
        return result;
    } catch (error) {
        if (retries <= 0 || error.code && error.code !== 'rate_limit_exceeded') {
            throw error;
        }
        console.warn(`Error occurred: ${error}. Retrying in ${delay}ms... (${retries} retries left)`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return retryWithExponentialBackoff(fn, retries - 1, delay * 2);
    }
}

// main();

async function test(){
     const completion = await openai.chat.completions.create({
      messages: [
        {role: "system", content: systemSchema},
        {role: "user", content: "What 1 +1?" }
      ],
      model: "gpt-3.5-turbo",
    });
    return completion.choices[0].message.content;
}

test();