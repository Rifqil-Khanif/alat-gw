require('./settings');
const fs = require('fs');
const pino = require('pino');
const path = require('path');
const axios = require('axios');
const chalk = require('chalk');
const figlet = require('figlet');
const readline = require('readline');
const FileType = require('file-type');
const { exec } = require('child_process');
const { Boom } = require('@hapi/boom');
const NodeCache = require('node-cache');
const PhoneNumber = require('awesome-phonenumber');
const { default: makeWASocket, useMultiFileAuthState, Browsers, DisconnectReason, makeInMemoryStore, makeCacheableSignalKeyStore, proto, getAggregateVotesInPollMessage } = require('@whiskeysockets/baileys');

let phoneNumber = "628895154319";
const pairingCode = !!phoneNumber || process.argv.includes("--pairing-code");
const useMobile = process.argv.includes("--mobile");
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));
let owner = JSON.parse(fs.readFileSync('./src/owner.json'));

// API for autoresponse
global.api = (name, path = '/', query = {}, apikeyqueryname) => (name in global.APIs ? global.APIs[name] : name) + path + (query || apikeyqueryname ? '?' + new URLSearchParams(Object.entries({ ...query, ...(apikeyqueryname ? { [apikeyqueryname]: global.APIKeys[name in global.APIs ? global.APIs[name] : name] } : {}) })) : '');

const DataBase = require('./src/database');
const database = new DataBase();
(async () => {
	const loadData = await database.read();
	if (loadData && Object.keys(loadData).length === 0) {
		global.db = {
			sticker: {},
			users: {},
			groups: {},
			database: {},
			settings: {},
			others: {},
			...(loadData || {}),
		};
		await database.write(global.db);
	} else {
		global.db = loadData;
	}
	
	setInterval(async () => {
		if (global.db) await database.write(global.db);
	}, 30000);
})();

const { GroupUpdate, GroupParticipantsUpdate, MessagesUpsert, Solving } = require('./src/message');
const { imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require('./lib/exif');
const { isUrl, generateMessageTag, getBuffer, getSizeMedia, fetchJson, await, sleep } = require('./lib/function');

console.log(chalk.cyan(figlet.textSync("XLICON-V4", {
    font: 'DOS Rebel',
    horizontalLayout: 'default',
    verticalLayout: 'default',
    width: 60,
    whitespaceBreak: false
})));

console.log(chalk.white.bold(`${chalk.gray.bold("📃  Information :")}         
✉️  Script : XLICON-V4-MD
✉️  Author : SALMAN AHMAD
✉️  Gmail : salmansheikh2500@gmail.com
✉️  Instagram : ahmmikun

${chalk.green.bold("Powered By XLICON BOTZ")}\n`));

// API Request to get the autoresponse message
async function getAutoresponse(message) {
    const apiUrl = `https://btch.us.kg/simi?text=${encodeURIComponent(message)}`;
    try {
        const response = await axios.get(apiUrl);
        if (response.data && response.data.message) {
            return response.data.message;
        }
        return "Sorry, couldn't fetch a response from the API.";
    } catch (error) {
        console.error("Error calling API:", error);
        return "There was an error while fetching a response.";
    }
}

// Start XliconBot
async function startXliconBot() {
    let version = [2, 3000, 1015901307];
    let isLatest = false;

    const { state, saveCreds } = await useMultiFileAuthState(`./session`);
    const msgRetryCounterCache = new NodeCache();
    
    const XliconBotInc = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: !pairingCode,
        browser: Browsers.windows('Firefox'),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
        },
        version, 
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true,
        getMessage: async (key) => {
            let jid = jidNormalizedUser(key.remoteJid);
            let msg = await store.loadMessage(jid, key.id);
            return msg?.message || "";
        },
        msgRetryCounterCache,
        defaultQueryTimeoutMs: undefined,
    });
   
    store.bind(XliconBotInc.ev);

    if (pairingCode && !XliconBotInc.authState.creds.registered) {
        if (useMobile) throw new Error('Cannot use pairing code with mobile API');

        let phoneNumber;
        phoneNumber = await question('Please enter your number starting with 92 :\n');
        phoneNumber = phoneNumber.trim();

        setTimeout(async () => {
            const code = await XliconBotInc.requestPairingCode(phoneNumber);
            console.log(chalk.black(chalk.bgGreen(`🎁  Pairing Code : ${code}`)));
        }, 3000);
    }

    store.bind(XliconBotInc.ev);
    await Solving(XliconBotInc, store);
    XliconBotInc.ev.on('creds.update', saveCreds);
    XliconBotInc.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, receivedPendingNotifications } = update;
        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output.statusCode;
            if (reason === DisconnectReason.connectionLost) {
                console.log('Connection to Server Lost, Attempting to Reconnect...');
                startXliconBot();
            } else if (reason === DisconnectReason.connectionClosed) {
                console.log('Connection closed, Attempting to Reconnect...');
                startXliconBot();
            } else if (reason === DisconnectReason.restartRequired) {
                console.log('Restart Required...');
                startXliconBot();
            } else if (reason === DisconnectReason.timedOut) {
                console.log('Connection Timed Out, Attempting to Reconnect...');
                startXliconBot();
            } else if (reason === DisconnectReason.badSession) {
                console.log('Delete Session and Scan again...');
                process.exit(1);
            } else if (reason === DisconnectReason.connectionReplaced) {
                console.log('Close current Session first...');
                XliconBotInc.logout();
            } else if (reason === DisconnectReason.loggedOut) {
                console.log('Scan again and Run...');
            } else if (reason === DisconnectReason.Multidevicemismatch) {
                console.log('Scan again...');
            } else {
                XliconBotInc.end(`Unknown DisconnectReason : ${reason}|${connection}`);
            }
        }
        if (connection == 'open') {
            console.log('Connected to : ' + JSON.stringify(XliconBotInc.user, null, 2));
        } else if (receivedPendingNotifications == 'true') {
            console.log('Please wait About 1 Minute...');
        }
    });
    
    XliconBotInc.ev.on('contacts.update', (update) => {
        for (let contact of update) {
            let id = XliconBotInc.decodeJid(contact.id);
            if (store && store.contacts) store.contacts[id] = { id, name: contact.notify };
        }
    });
    
    XliconBotInc.ev.on('call', async (call) => {
        let botNumber = await XliconBotInc.decodeJid(XliconBotInc.user.id);
        let anticall = global.db.settings[botNumber].anticall;
        if (anticall) {
            for (let id of call) {
                if (id.status === 'offer') {
                    let msg = await XliconBotInc.sendMessage(id.from, { text: `Currently, We Cannot Receive Calls ${id.isVideo ? 'Video' : 'Voice'}.\nIf @${id.from.split('@')[0]} Needs Help, Please Contact Owner :)`, mentions: [id.from] });
                    await XliconBotInc.sendContact(id.from, global.owner, msg);
                    await XliconBotInc.rejectCall(id.id, id.from);
                }
            }
        }
    });

// Auto-Welcome and Auto-Bye Feature with API-generated images
XliconBotInc.ev.on('group-participants.update', async (update) => {
    const { id, participants, action } = update;
    for (let participant of participants) {
        try {
            const groupMetadata = await XliconBotInc.groupMetadata(id);
            const groupName = groupMetadata.subject;
            const groupDesc = groupMetadata.desc || "No description available";
            const participantName = participant.split('@')[0];
            const memberCount = groupMetadata.participants.length;

            // Get profile pictures
            const ppGroup = await XliconBotInc.profilePictureUrl(id, 'image').catch(() => 'https://tse4.mm.bing.net/th?id=OIP.JjURR9U0gcrqneGYVyG27wHaEn&pid=Api&P=0&h=180');
            const ppUser = await XliconBotInc.profilePictureUrl(participant, 'image').catch(() => 'https://tse4.mm.bing.net/th?id=OIP.JjURR9U0gcrqneGYVyG27wHaEn&pid=Api&P=0&h=180');

            // Background image URL (you can change this to any image URL you prefer)
            const bgImage = 'https://images3.alphacoders.com/131/thumbbig-1319293.webp';

            if (action === 'add') {
                // Welcome message
                const welcomeText = `HALO @${participantName} selamat datang di grup ${groupName} semoga betah dan jangan lupa patuhi DESKRIPSI\n\nDESKRIPSI:\n${groupDesc}\n\nHELLO @${participantName} welcome to the group ${groupName} hope you feel at home and don't forget to follow the DESCRIPTION`;

                // Generate welcome image using the API
                const welcomeImageUrl = `https://btch.us.kg/welcome3?name=${encodeURIComponent(participantName)}&gcname=${encodeURIComponent(groupName)}&ppgc=${encodeURIComponent(ppGroup)}&member=${encodeURIComponent(memberCount)}&pp=${encodeURIComponent(ppUser)}&bg=${encodeURIComponent(bgImage)}`;

                // Send the welcome message with the generated image
                await XliconBotInc.sendMessage(id, {
                    image: { url: welcomeImageUrl },
                    caption: welcomeText,
                    mentions: [participant]
                });
            } else if (action === 'remove') {
                // Goodbye message
                const goodbyeText = `BYE @${participantName} 👋`;
            
                // Use the user's profile picture or the default image
                const goodbyeImageUrl = ppUser !== 'https://tse4.mm.bing.net/th?id=OIP.JjURR9U0gcrqneGYVyG27wHaEn&pid=Api&P=0&h=180' 
                    ? ppUser 
                    : 'https://images3.alphacoders.com/131/thumbbig-1319293.webp';
            
                // Send the goodbye message with the profile picture or default image
                await XliconBotInc.sendMessage(id, {
                    image: { url: goodbyeImageUrl },
                    caption: goodbyeText,
                    mentions: [participant]
                });
            }
        } catch (err) {
            console.error('Error in welcome/goodbye feature:', err);
        }
    }
});




    // Handle messages and autoresponse
    XliconBotInc.ev.on('messages.upsert', async (message) => {
        const msgContent = message.messages[0].text;
        if (msgContent) {
            const response = await getAutoresponse(msgContent);
            XliconBotInc.sendMessage(message.messages[0].key.remoteJid, { text: response });
        }
        await MessagesUpsert(XliconBotInc, message, store);
    });

    return XliconBotInc;
}

startXliconBot();