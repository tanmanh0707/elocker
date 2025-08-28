// npm install serialport readline-sync

const { SerialPort } = require('serialport');
const readlineSync = require('readline-sync');
const readline = require("readline");
const ByteLength = require('@serialport/parser-byte-length');

let deviceId = 0;
let MESS_CU_TEMP = [0x02, 0x00, 0x30, 0x03, 0x35];

function checkSum(arr) {
    let sum = 0;
    for (let i of arr) {
        sum += i;
    }
    return sum & 0xff;
}

function  delay(time){
    return  new Promise((resolve) => setTimeout(resolve, time))
}

function buildMessage() {
    let MESS_CU = [...MESS_CU_TEMP];
    MESS_CU[2] = 0x30;
    MESS_CU[1] = (deviceId << 4) | 0;
    let mess_sum = MESS_CU.slice(0, MESS_CU.length - 1);
    MESS_CU[4] = checkSum(mess_sum);
    return Buffer.from(MESS_CU);
}

function buildOpenLockMessage(deviceId, lockId) {
	let MESS_CU = [...MESS_CU_TEMP];
	MESS_CU[1]=(deviceId<<4)|(lockId);
	MESS_CU[2]=0x31;
	let mess_sum=MESS_CU.slice(0,MESS_CU.length-1);
	MESS_CU[4]=checkSum(mess_sum);
	return Buffer.from(MESS_CU);
}

function questionAsync(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (ans) => { rl.close(); resolve(ans); }));
}

async function main() {
  let dataReceived = false;
  try {
    var ports;
    do {
      ports = await SerialPort.list();
      if (ports.length === 0) {
        console.log("⚠️ No COM port found.");
      }
    } while (ports.length === 0);

    console.log("COM port list:");
      ports.forEach((p, idx) => {
      console.log(`${idx + 1}) ${p.path} - ${p.friendlyName || ""}`);
    });

    const ans = await questionAsync("Select COM port: ");
    const idx = Number(ans.trim()) - 1;
    if (idx < 0 || idx >= ports.length) {
      console.log("❌ Invalid selection");
      return;
    }

    const port = new SerialPort({ path: ports[idx].path, baudRate: 19200 });
		//let port = newport.pipe(new ByteLength({length:9}))

    port.on('data', (data) => {
      console.log("RX:", data.toString('hex').match(/.{1,2}/g).join(' '));
      dataReceived = true;
    });

    port.on('open', () => {
      console.log("COM port opened!");
      setInterval(() => {
        var msg;
        if (dataReceived) {
          dataReceived = false;
          msg = buildOpenLockMessage()
        } else {
          msg = buildMessage();
        }

        port.write(msg, (err) => {
          if (err) {
            console.error("Send failed:", err.message);
          } else {
            console.log("TX:", msg.toString('hex').match(/.{1,2}/g).join(' '));
          }
        });
      }, 1000);
    });
  } catch (err) {
    console.error("Lỗi:", err);
  }
}

main();
