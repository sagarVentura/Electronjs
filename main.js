
const { app, BrowserWindow, dialog, net, ipcMain } = require('electron');
const path = require('path');
const { exec, execSync } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');



const key = crypto.scryptSync('your-secret-password', 'some-salt', 32);
/* live testing*/
const decryptedPath = path.join(app.getPath('temp'), 'decrypted-scorm');
let encryptedPath = null;
let scormContentPath="scormcontent"

let USBPath=null;

/*lauchpage.html page of showing ring spinner intial page*/
let htmlfilePath="htmlPage/launchpage.html"

/*local  testing*/
// const decryptedPath = path.join(__dirname, 'decryptedFolder');
// let encryptedPath = path.join(__dirname, scormContentPath);



// Enable hot reload during development (optional)
try {
  require('electron-reload')(path.join(__dirname), {
    electron: path.join(__dirname, 'node_modules', '.bin', 'electron')
  });
} catch (_) {
  console.log('Error enabling electron-reload');
}


// Function to get allowed serial numbers from server using `net` and POST
function getAllowedSerials({ serialNumber }) {
  return new Promise((resolve, reject) => {
    const request = net.request({
      method: 'POST',
      protocol: 'https:',
      hostname: 'dhioo.venturaelearning.com',
      path: '/api/organisation/serialnumber',
    });

    // Optional: Add request body

    const postData = JSON.stringify({ serialNumber });
    request.setHeader('Content-Type', 'application/json');

    // // Optional: Add timeout (in milliseconds)
    const timeout = setTimeout(() => {
      request.abort(); // Abort the request
      reject(new Error('Request timed out'));
    }, 5000); // 10 seconds timeout

    let body = '';

    request.on('response', (response) => {
      clearTimeout(timeout);
      const statusCode = response.statusCode;


      if (statusCode < 200 || statusCode >= 300) {
        /*Error message*/
        reject({
          title: 'Server Unreachable',
          message: 'The server could not be reached at the moment.\nPlease try again after 1 hour.\nIf the issue still persists, Please contact your regional Rieter sales team with the USB serial number (found on the USB cover)',
          show: true
        });

      }

      response.on('data', (chunk) => {
        body += chunk.toString();
      });

      response.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve(json?.data ?? []);
        } catch (err) {
                  /*Error message*/
          reject({ message: 'Failed to parse server response, Please contact your regional Rieter sales team with the USB serial number (found on the USB cover)', title: "Parsing Error" });
        }
      });
    });

    request.on('error', (error) => {
              /*Error message*/
      reject({ title: `Network error`, message: "ROOT license verification failed. Please connect to the internet and try again." });
    });

    // Send request body
    request.write(postData);
    request.end();
  });
}

function getUSBSerials() {
  const platform = process.platform;

  return new Promise((resolve, reject) => {
    if (platform === 'win32') {
       exec(`wmic diskdrive where "InterfaceType='USB'" get DeviceID`, (err, stdout) => {
      if (err) return reject(err);

      const lines = stdout.split('\n').map(line => line.trim()).filter(Boolean);
      const deviceIDs = lines.slice(1);

      // Get all serials with Win32_PhysicalMedia
      exec(`wmic path Win32_PhysicalMedia get SerialNumber`, (err2, stdout2) => {
        if (err2) return reject(err2);

        const serialLines = stdout2.split('\n').map(line => line.trim()).filter(Boolean);
        const serials = serialLines.slice(1).filter(Boolean);

        // Note: This approach assumes ordering matches, which may not always be reliable.
        // For production, query via PowerShell CIM to correlate DeviceID and SerialNumber accurately.

        resolve(serials);
      });
    });

    } else if (platform === 'linux') {
      exec(`lsusb -v 2>/dev/null | grep -i "iSerial"`, (err, stdout) => {
        if (err) return reject(err);

        const serials = stdout
          .split('\n')
          .map(line => line.trim().split(/\s+/).slice(2).join(' '))
          .filter(Boolean);
        resolve(serials);
      });

    } else if (platform === 'darwin') {
      exec(`system_profiler SPUSBDataType | grep -i "Serial Number"`, (err, stdout) => {
        if (err) return reject(err);

        const serials = stdout
          .split('\n')
          .map(line => line.split(':').pop().trim())
          .filter(Boolean);
        resolve(serials);
      });

    } else {
      reject(new Error(`Unsupported platform: ${platform}`));
    }
  });
}


// Create the main window
function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      devTools: false,
      preload: path.join(__dirname, 'preload.js'), // ✅ Make sure this path is correct

    }
  });


  // Disable right-click
  win.webContents.on('context-menu', (e) => e.preventDefault());

  /*ovpen development tool*/
  //win.webContents.openDevTools(); // ✅ Enable browser console

  ipcMain.handle('get-usb-info', () => {
    const devices = usb.getDeviceList();
    return devices.map(device => {
      const desc = device.deviceDescriptor;
      return {
        vendorId: desc.idVendor,
        productId: desc.idProduct,
        serialNumberIndex: desc.iSerialNumber  // Note: not the actual serial string
      };
    });
  });

 
  /*Decrypt specific course when user click on it*/
  ipcMain.handle('decrypt-course', async (event, courseName) => {
    const courseEncryptedDir = path.join(encryptedPath, courseName);
    const courseDecryptedDir = path.join(decryptedPath, courseName);


    try {
      // Check if encrypted directory exists
      if (!fs.existsSync(courseEncryptedDir)) {
        /*Error message*/
        dialog.showErrorBox("Package not found", "For assistance, Please contact your regional Rieter sales team with the USB serial number (found on the USB cover)");
        return null;
      }

      // 🔒 Check read access
      try {
        fs.accessSync(courseEncryptedDir, fs.constants.R_OK);
      } catch (err) {
        if (err.code === 'EACCES' || err.code === 'EPERM') {
                  /*Error message*/
          dialog.showErrorBox("Permission Denied", "Access to the ROOT USB drive is blocked. Please allow permission in your system settings and try again.");
          return null;
        } else {
          throw err; // Unknown error, rethrow
        }
      }

      // Decrypt only if not already decrypted
      if (!fs.existsSync(courseDecryptedDir)) {
        decryptFolderRecursive(courseEncryptedDir, courseDecryptedDir);
      }

      // return courseDecryptedDir;

   await  openScormWindow(courseDecryptedDir)

    } catch (err) {
      console.error("Decryption failed:", err);
              /*Error message*/
      dialog.showErrorBox("Error Decryption failed", "For assistance, Please contact your regional Rieter sales team with the USB serial number (found on the USB cover)");
      return null;
    }
  });

  /*load html file present in pendrive like lauchpage.html inside htmlpage */
  ipcMain.on('open-local-html', (event) => {
    /*local testing */
    // if(!USBPath){
    //   USBPath=__dirname
    // }

   let filePath= path.join(USBPath, htmlfilePath)
    
    if (!fs.existsSync(filePath)) {
      dialog.showErrorBox("File Not Found", `Please contact your regional Rieter sales team with the USB serial number (found on the USB cover)`);
      return;
    }

    const htmlWin = new BrowserWindow({
      width: 1200,
      height: 800,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });

    htmlWin.removeMenu();
    htmlWin.webContents.on('context-menu', e => e.preventDefault());
    htmlWin.loadURL(`file://${filePath}`);
  });


  /*common function which take path of  scorm package  and load it in browser window*/
  async function openScormWindow(coursePath) {
    // console.log("Opening SCORM:", coursePath);
    try{
    if (!fs.existsSync(coursePath)) {
      dialog.showErrorBox("File Not Found", `Please contact your regional Rieter sales team with the USB serial number (found on the USB cover)`);
   throw  "path of decrypt folder is not exist"
    }
  
    const scormWin = new BrowserWindow({
      width: 1200,
      height: 800,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });
  
    scormWin.removeMenu();
    scormWin.webContents.on('context-menu', e => e.preventDefault());
  
    // Launch SCORM HTML file (story.html or index.html)
    const possibleEntries = ['story.html', 'index_lms.html', 'index.html'];
    const entry = possibleEntries.find(f => fs.existsSync(path.join(coursePath, f)));
  
    if (!entry) {
      dialog.showErrorBox("Invalid SCORM", "No valid launch file found.");
      throw  "Invalid SCORM", "No valid launch file found."
    }

    scormWin.loadFile(path.join(coursePath, 'story.html'));
  }
  catch(err){
    throw err;
  }
  }
  
  /*scorm opening handler through  ipcMain handler means we can it in our html files*/
  ipcMain.on('open-scorm', (event, coursePath) => {
    console.log("coursePath", coursePath)
    const scormWin = new BrowserWindow({
      width: 1200,
      height: 800,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, 'preload.js')  // ✅ link preload

      }
    });

    scormWin.loadFile(path.join(coursePath, 'story.html'));
  });


  // Block copy, print, save
  win.webContents.on('before-input-event', (event, input) => {
    const blocked = ['c', 'v', 'a', 's', 'p'];
    if ((input.control || input.meta) && blocked.includes(input.key.toLowerCase())) {
      event.preventDefault();
    }
  });

  win.loadFile('index.html');
}

app.whenReady().then(async () => {

  // Step 1: get serial number list of all available devices
  let result = await getUSBSerials();
  if (!result?.length) {
    /*means  we don't get information or detail of connected device to system */
            /*Error message*/
    dialog.showErrorBox("Access Denied", "Unable to verify ROOT USB drive");
    app.quit();
    return;
  }


  // Step 2: get USB PATH
  const usbPath = findUSBDrivePath();
  if (!usbPath) {
    console.log("No USB drive detected.");
            /*Error message*/

    dialog.showErrorBox("Fail to varify ", "No ROOT USB drive path detected. Please contact your regional Rieter sales team with the USB serial number (found on the USB cover)");
    app.quit();

  } else {
    USBPath=usbPath;
    /*we updated global variable  encryptedPath*/
    encryptedPath = path.join(usbPath, scormContentPath);
    /*check is path is exit or not*/
    if (!fs.existsSync(encryptedPath)) {
              /*Error message*/
      dialog.showErrorBox("Fail to varify content path", "Please contact your regional Rieter sales team with the USB serial number (found on the USB cover).");
      app.quit();

    }
  }




  // Step 3: send serial number to server to check is it is valide and  not expire pendrive by  `net
  let allowedSerials = {};
  try {
    allowedSerials = await getAllowedSerials({ serialNumber: result });
    console.log("allowedSerials", allowedSerials)
  } catch (err) {
    // Check for known network-related error codes

    dialog.showErrorBox(
      err?.title || "Error",
      err?.message || "An unexpected error occurred during license verification."
    );

    app.quit();
    return;
  }
  // Step 4: on the bases of allowedSerials check whether user can allow to view content or quit app
  if (!allowedSerials?.valid) {
    dialog.showErrorBox(allowedSerials?.title??"Fail to verify", allowedSerials?.message ?? "");
    app.quit();
    return;
  }

  // Step 5: Launch app
  createWindow();
}).catch((err) => {
  console.log("err", err)
});

/* On app Quit by user */
app.on('will-quit', cleanDecryptedFolder);

/*On app crash or unexpected error occurs*/
process.on('exit', cleanDecryptedFolder);

function cleanDecryptedFolder() {
  try {
    if (fs.existsSync(decryptedPath)) {
      fs.rmSync(decryptedPath, { recursive: true, force: true });
      console.log("🧹 Decrypted folder deleted.");
    }
  } catch (err) {
    console.error("❌ Failed to clean decrypted folder:", err);
  }
}



/*
Icons build command

npx electron-icon-maker --input=Asset/icon.png --output=Asset/icons
*/


function decryptFile(inputPath, outputPath) {
  const data = fs.readFileSync(inputPath);

  if (data.length <= 16) {
    throw new Error('Invalid encrypted file: too short');
  }

  const iv = data.slice(0, 16);
  const encrypted = data.slice(16);

  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);

  let decrypted;
  try {
    decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch (err) {
    throw new Error(`Decryption failed for ${inputPath}: ${err.message}`);
  }

  console.log("outputPath", outputPath)
  fs.writeFileSync(outputPath, decrypted);
}


function decryptFolderRecursive(encryptedDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });

  const items = fs.readdirSync(encryptedDir);
  for (const item of items) {
    const encPath = path.join(encryptedDir, item);
    const stat = fs.statSync(encPath);

    if (stat.isDirectory()) {
      // Recurse into subdirectory and preserve folder structure
      const newTargetDir = path.join(targetDir, item);
      decryptFolderRecursive(encPath, newTargetDir);
    } else if (stat.isFile() && path.extname(item) === '.enc') {
      // Remove .enc extension for output file
      const baseName = path.basename(item, '.enc');
      const outputPath = path.join(targetDir, baseName);

      try {
        decryptFile(encPath, outputPath);
      } catch (err) {
        console.error(`❌ Failed to decrypt ${encPath}: ${err.message}`);
      }
    }
  }
}



function findUSBDrivePath() {
  const platform = os.platform();
  const appPath = app.getAppPath(); // Path where the app is running from
  console.log("appPath", appPath)
  try {
    if (platform === 'darwin') {
      const usbPaths = [];
      const volumes = fs.readdirSync('/Volumes');
      for (const name of volumes) {
        if (name !== 'Macintosh HD') {
          const fullPath = path.join('/Volumes', name);
          if (fs.existsSync(fullPath)) {
            usbPaths.push(fullPath);
          }
        }
      }

      if (usbPaths.length > 1) {
        const fromUSB = usbPaths.find(p => {
          console.log(p, appPath)
          return appPath.startsWith(p)
        });
        if (fromUSB) return fromUSB;

        // dialog.showErrorBox(
        //   'Multiple USB Drives Detected',
        //   'More than one USB drive is connected.\nPlease remove extra drives and try again.'
        // );
        // app.quit();
        return;
      }

      return usbPaths[0] || null;
    }

    if (platform === 'win32') {
      const output = execSync(`wmic logicaldisk where "drivetype=2" get deviceid`, { encoding: 'utf8' });
      const lines = output.split('\n').map(line => line.trim()).filter(Boolean);
      const deviceIds = lines.filter(line => /^[A-Z]:/.test(line)).map(id => id + '\\');
console.log("deviceIds",deviceIds,'appPath',appPath)
      if (deviceIds.length > 1) {
        const fromUSB = deviceIds.find(p => appPath.toLowerCase().startsWith(p.toLowerCase()));
        if (fromUSB) return fromUSB;

        // dialog.showErrorBox(
        //   'Multiple USB Drives Detected',
        //   'More than one USB drive is connected.\nPlease remove extra drives and try again.'
        // );
        // app.quit();
        return;
      }

      return deviceIds[0] || null;
    }

    if (platform === 'linux') {
      const baseDirs = [
        `/media/${os.userInfo().username}`,
        `/run/media/${os.userInfo().username}`,
        `/mnt`
      ];

      const usbDrives = [];

      for (const base of baseDirs) {
        if (fs.existsSync(base)) {
          const entries = fs.readdirSync(base);
          for (const name of entries) {
            const fullPath = path.join(base, name);
            if (fs.statSync(fullPath).isDirectory()) {
              usbDrives.push(fullPath);
            }
          }
        }
      }

      if (usbDrives.length > 1) {
        const fromUSB = usbDrives.find(p => appPath.startsWith(p));
        if (fromUSB) return fromUSB;

        // dialog.showErrorBox(
        //   'Multiple USB Drives Detected',
        //   'More than one USB drive is connected.\nPlease remove extra drives and try again.'
        // );
        // app.quit();
        return;
      }

      return usbDrives[0] || null;
    }

  } catch (err) {
    console.error("Error finding USB path:", err);
    dialog.showErrorBox("USB Detection Error", "An error occurred while trying to detect the ROOT USB drive.");
    app.quit();
    return;
  }

  dialog.showErrorBox("USB Not Found", "No USB drive was detected. Please insert the authorized USB and try again.");
  app.quit();
  return;
}


