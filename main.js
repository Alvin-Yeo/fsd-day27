// load libraries
const express = require('express');
const morgan = require('morgan');
const { MongoClient } = require('mongodb');
const fs = require('fs');
const multer = require('multer');
const AWS = require('aws-sdk');

// environment configuration
require('dotenv').config();
const PORT = parseInt(process.argv[2]) || parseInt(process.env.PORT) || 3000;

// constants
const DB_NAME = 'take-temp-together';
const COLLECTION_NAME = 'temperature';

// functions
const makeTemperature = (params, randomFileName) => {
    return {
        ts: new Date(),
        user: params.username,
        q1: params.q1.toLowerCase() == 'true',
        q2: params.q2.toLowerCase() == 'true',
        temperature: parseFloat(params.temperature),
        image: randomFileName
    }
}

const readFile = (path) => {
    return new Promise((resolve, reject) => {
        fs.readFile(path, (error, buff) => {
            if(error != null) 
                reject(error);
            else
                resolve(buff);
        });
    });
};

const putObject = (file, buff, s3) => {
    return new Promise((resolve, reject) => {
        const params = {
            Bucket: 'fsd-2020',
            Key: file.filename,
            Body: buff,
            ACL: 'public-read',
            ContentType: file.mimetype,
            ContentLength: file.size
        };

        s3.putObject(params, (error, result) => {
            if(error != null)
                reject(error);
            else    
                resolve(result);
        });
    });
};

/* AWS S3 */

// S3 configuration

// Please set the two following variables in the environment
// AWS_ACCESS_KEY_ID=
// AWS_SECRET_ACCESS_KEY=
// For more info, please refer to "https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/loading-node-credentials-environment.html"

// AWS.config.credentials = new AWS.SharedIniFileCredentials({ profile: 'fsd-2020' });
const s3 = new AWS.S3({
    endpoint: new AWS.Endpoint('sfo2.digitaloceanspaces.com')
})

// multer configuration
const upload = multer({
    dest: process.env.TMP_DIR || 'temp'
});

/* MongoDB */

// connection string for mongo client
const MONGO_URL = 'mongodb://localhost:27017';

// create connection pool with mongo client
const mongoClient = new MongoClient(MONGO_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

// create an instance of express
const app = express();

// logging all requests with morgan
app.use(morgan('combined'));

// resources

// GET /temperature/:username
app.get('/temperature/:username', (req, res) => {
    const username = req.params['username'];

    mongoClient.db(DB_NAME)
        .collection(COLLECTION_NAME)
        .find({
            user: username
        })
        .toArray()
        .then((result) => {
            const data = result.map((elem, index) => ({
                sn: index + 1,
                timestamp: (new Date(elem['ts'])).toString(),
                username: elem['user'],
                q1: elem['q1'],
                q2: elem['q2'],
                temperature: elem['temperature'],
                image: (elem['image']) ? 'https://fsd-2020.sfo2.digitaloceanspaces.com/' + elem['image'] : ''
            }));

            res.status(200);
            res.type('application/json');
            res.json(data);
        })
        .catch((error) => {
            console.error(`[ERROR] Failed to retrieve documents.`);
            console.error(`[ERROR] Error message: `, error);

            res.status(500);
            res.type('application/json');
            res.json({ error: error });
        });
});

// POST /temperature
app.post('/temperature',
    upload.single('temp-img'),
    // express.urlencoded({ extended: true }),
    // express.json(),
    (req, res) => {
        // console.log('>>> req.body: ', req.body);
        // console.log('>>> req.file: ', req.file);

        const doc = makeTemperature(req.body, req.file.filename);

        readFile(req.file.path)
            .then((buff) => {
                return putObject(req.file, buff, s3);
            })
            .then((result) => {
                return mongoClient.db(DB_NAME)
                    .collection(COLLECTION_NAME)
                    .insertOne(doc);
            })
            .then((result) => {
                res.status(200);
                res.type('application/json');
                res.json({ 
                    status: 'Document inserted successfully.',
                    insertedCount: result['insertedCount'], 
                    insertedId: result['insertedId']
                });
            })
            .catch((error) => {
                console.error(`[ERROR] Failed to insert document.`);
                console.error(`[ERROR] Error message: `, error);

                res.status(500);
                res.type('application/json');
                res.json({ error: error });
            });
        

        res.on('finish', () => {
            fs.unlink(req.file.path, () => {});
            console.log('>>> RESPONSE END <<<');
        });
    }
)

// test all db connections before starting sevrer
const startApp = (app, mongoClient) => {
    
    // checking S3 Access Key in shared credential files or environment variables
    const p0 = new Promise((resolve, reject) => {
        // if(!!AWS.config.credentials['accessKeyId'] || (!!process.env.AWS_ACCESS_KEY_ID && !!process.env.AWS_SECRET_ACCESS_KEY))
        if(!!process.env.AWS_ACCESS_KEY_ID && !!process.env.AWS_SECRET_ACCESS_KEY)
            resolve();
        else
            reject('S3 Access Key not found in environment variables.'); 
    });

    // checking mongodb connection
    const p1 = mongoClient.connect();

    
    Promise.all([ p0, p1 ])
        .then((results) => {
            app.listen(PORT, () => {
                console.info(`[INFO] Express server started on port ${PORT} at ${new Date()}`);
            });
        })
        .catch((error) => {
            console.error(`[ERROR] Unable to start server.`);
            console.error(`[ERROR] Error message: `, error);
        });
};

// start server
startApp(app, mongoClient);

// clear all the temp files when server stopped / restarted

