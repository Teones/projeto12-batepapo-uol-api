import express, { json } from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import dayjs from 'dayjs';
import joi from 'joi';
import { stripHtml } from "string-strip-html";
dotenv.config();

const app = express();
app.use(cors());
app.use(json());

const participantSchema = joi.object({
  name: joi.string().required()
})

const messageSchema = joi.object({
  to: joi.string().required(),
  text: joi.string().required(),
  type: joi.string().valid('message', 'private_message'),
})

function filterParticipantMessages(message, participant) {
  const { to, from, type } = message;

  const isFromOrToParticipant = to === participant || from === participant || to === 'Todos';
  const isPublic = type === 'message';

  if (isFromOrToParticipant || isPublic) {
    return true;
  }

  return false;
}

app.post('/participants', async (req, res) => {
  const participant = req.body;

  const validation = participantSchema.validate(participant);
  if (validation.error) {
    return res.sendStatus(422)
  }

  participant.name = stripHtml(participant.name).result.trim();

  try {
    const mongoClient = new MongoClient(process.env.MONGO_URI);
    await mongoClient.connect()

    const participantsCollection = mongoClient.db("bate-papo-uol").collection("participants");
    const messagesCollection = mongoClient.db("bate-papo-uol").collection("messages");

    const existingParticipant = await participantsCollection.findOne({ name: participant.name });
    if (existingParticipant) {
      return res.sendStatus(409);
    }

    await participantsCollection.insertOne({ ...participant, lastStatus: Date.now() });

    await messagesCollection.insertOne({
      from: participant.name,
      to: 'Todos',
      text: 'entra na sala...',
      type: 'status',
      time: dayjs().format("HH:mm:ss")
    });

    await mongoClient.close();
    res.sendStatus(201);
  } catch (error) {
    console.log(error);
    res.sendStatus(500);
  }
});

app.get('/participants', async (req, res) => {
  try {
    const mongoClient = new MongoClient(process.env.MONGO_URI);
    await mongoClient.connect()

    const participantsCollection = mongoClient.db("bate-papo-uol").collection("participants");

    const participants = await participantsCollection.find({}).toArray();

    await mongoClient.close();
    res.send(participants);
  } catch (error) {
    console.log(error);
    res.sendStatus(500);
  }
});

app.post('/messages', async (req, res) => {
  const message = req.body;
  const from = req.headers.user;

  const validation = messageSchema.validate(message);
  if (validation.error) {
    return res.sendStatus(422);
  }

  message.to = stripHtml(message.to).result.trim();
  message.text = stripHtml(message.text).result.trim();

  try {
    const mongoClient = new MongoClient(process.env.MONGO_URI);
    await mongoClient.connect()

    const participantsCollection = mongoClient.db("bate-papo-uol").collection("participants");
    const messagesCollection = mongoClient.db("bate-papo-uol").collection("messages");

    const existingParticipant = await participantsCollection.findOne({ name: from })
    if (!existingParticipant) {
      return res.sendStatus(422);
    }

    await messagesCollection.insertOne({
      ...message,
      from,
      time: dayjs().format("HH:mm:ss")
    });

    await mongoClient.close();
    res.sendStatus(201);
  } catch (error) {
    console.log(error);
    res.sendStatus(500);
  }
});

app.get('/messages', async (req, res) => {
  const limit = parseInt(req.query.limit);
  const participant = req.headers.user;

  try {
    const mongoClient = new MongoClient(process.env.MONGO_URI);
    await mongoClient.connect()

    const messagesCollection = mongoClient.db("bate-papo-uol").collection("messages");

    const messages = await messagesCollection.find({}).toArray();

    const participantMessages = messages.filter((message) => filterParticipantMessages(message, participant))

    await mongoClient.close();

    if (limit !== NaN && limit) {
      return res.send(participantMessages.slice(-limit));
    }

    res.send(participantMessages);
  } catch (error) {
    console.log(error);
    res.sendStatus(500);
  }
});

app.delete('/messages/:id', async (req, res) => {
  const { id } = req.params;
  const participant = req.headers.user;

  try {
    const mongoClient = new MongoClient(process.env.MONGO_URI);
    await mongoClient.connect()

    const messagesCollection = mongoClient.db("bate-papo-uol").collection("messages");

    const existingMessage = await messagesCollection.findOne({ _id: new ObjectId(id) })
    if (!existingMessage) {
      return res.sendStatus(404);
    }

    if (existingMessage.from !== participant) {
      return res.sendStatus(401);
    }

    await messagesCollection.deleteOne({
      _id: existingMessage._id
    });

    await mongoClient.close();
    res.sendStatus(200);
  } catch (error) {
    console.log(error);
    res.sendStatus(500);
  }
});

app.put('/messages/:id', async (req, res) => {
  const message = req.body;
  const { id } = req.params;
  const from = req.headers.user;

  const validation = messageSchema.validate(message);
  if (validation.error) {
    return res.sendStatus(422);
  }

  try {
    const mongoClient = new MongoClient(process.env.MONGO_URI);
    await mongoClient.connect()

    const participantsCollection = mongoClient.db("bate-papo-uol").collection("participants");
    const messagesCollection = mongoClient.db("bate-papo-uol").collection("messages");

    const existingParticipant = await participantsCollection.findOne({ name: from })
    if (!existingParticipant) {
      return res.sendStatus(422);
    }

    const existingMessage = await messagesCollection.findOne({ _id: new ObjectId(id) });
    if (!existingMessage) {
      return res.sendStatus(404);
    }

    if (existingMessage.from !== from) {
      return res.sendStatus(401);
    }

    await messagesCollection.updateOne({
      _id: new ObjectId(id)
    }, {
      $set: message
    });

    await mongoClient.close();
    res.sendStatus(201);
  } catch (error) {
    console.log(error);
    res.sendStatus(500);
  }
});

app.post('/status', async (req, res) => {
  const participant = req.headers.user;

  try {
    const mongoClient = new MongoClient(process.env.MONGO_URI);
    await mongoClient.connect()

    const participantsCollection = mongoClient.db("bate-papo-uol").collection("participants");

    const existingParticipant = await participantsCollection.findOne({ name: participant })
    if (!existingParticipant) {
      return res.sendStatus(404);
    }

    await participantsCollection.updateOne({
      _id: existingParticipant._id
    }, {
      $set: { lastStatus: Date.now() }
    });

    await mongoClient.close();
    res.sendStatus(200);
  } catch (error) {
    console.log(error);
    res.sendStatus(500);
  }
})

setInterval(async () => {
  try {
    const lastTenSeconds = Date.now() - 10000;

    const mongoClient = new MongoClient(process.env.MONGO_URI);
    await mongoClient.connect()

    const participantsCollection = mongoClient.db("bate-papo-uol").collection("participants");
    const messagesCollection = mongoClient.db("bate-papo-uol").collection("messages");

    const participants = await participantsCollection.find().toArray();

    const inactiveParticipants = participants.filter(participant => participant.lastStatus <= lastTenSeconds)
    if (inactiveParticipants.length === 0) {
      await mongoClient.close();
      return;
    }

    //  $lte === less then or equal to, mesmo efeito do filter de cima
    await participantsCollection.deleteMany({ lastStatus: { $lte: lastTenSeconds } });

    const inactiveParticipantsMessages = inactiveParticipants.map(participant => {
      return {
        from: participant.name,
        to: 'Todos',
        text: 'sai da sala...',
        type: 'status',
        time: dayjs().format("HH:mm:ss")
      }
    })

    await messagesCollection.insertMany(inactiveParticipantsMessages);

    await mongoClient.close();
  } catch (error) {
    console.log(error);
  }
}, 15000)

app.listen(5000, () => {
  console.log("Listening on 5000")
})
