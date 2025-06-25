
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


/*local  testing*/
//const decryptedPath = path.join(__dirname, 'decryptedFolder');

//const encryptedPath = path.join(__dirname, '../encryptFolder');

console.log("__dirname", decryptedPath)




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


    // const request = net.request({
    //   method: 'POST',
    //   protocol: 'http:',
    //   hostname: 'localhost',     // ✅ Only the hostname here
    //   port: 3300,                // ✅ Port must be passed separately
    //   path: '/api/organisation/serialnumber',
    // });


    // Optional: Add request body

    const postData = JSON.stringify({ serialNumber });
    request.setHeader('Content-Type', 'application/json');



    let body = '';

    request.on('response', (response) => {
      response.on('data', (chunk) => {
        body += chunk.toString();
      });

      response.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve(json?.data ?? []);
        } catch (err) {
          reject(new Error('Failed to parse server response'));
        }
      });
    });

    request.on('error', (error) => {
      reject(error);
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
      exec(`wmic diskdrive where "InterfaceType='USB'" get SerialNumber`, (err, stdout) => {
        if (err) return reject(err);

        const lines = stdout.split('\n').map(line => line.trim()).filter(Boolean);
        const serials = lines.slice(1).filter(Boolean); // Remove header
        resolve(serials);
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
      devTools: true,
      preload: path.join(__dirname, 'preload.js'), // ✅ Make sure this path is correct

    }
  });


  // Disable right-click
  win.webContents.on('context-menu', (e) => e.preventDefault());

  /*ovpen development tool*/
  win.webContents.openDevTools(); // ✅ Enable browser console

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

  ipcMain.handle('get-scorm-courses', () => {
    let folders = fs.readdirSync(encryptedPath);
    folders = folders.filter(folder => {
      /* item is not folder then not include it because in  encryptedPath their .DS_Store file present*/

      const fullPath = path.join(encryptedPath, folder);
      return fs.statSync(fullPath).isDirectory()

    });

    console.log("folders", folders)

    /*We Create array of folder available*/
    return folders.map(folder => ({
      name: folder,
      path: path.join(encryptedPath)
    }));
  });

  /*Decrypt specific course when user click on it*/
  ipcMain.handle('decrypt-course', async (event, courseName) => {
    const courseEncryptedDir = path.join(encryptedPath, courseName);
    const courseDecryptedDir = path.join(decryptedPath, courseName);
    console.log("call", courseName)
    try {
      //  if decrypt folder is exist then use it, otherwise create new decrypt folder
      if(!fs.existsSync(courseEncryptedDir)){
        dialog.showErrorBox("Package not found", "please connect with admin.");
return null;
      }
      if (!fs.existsSync(courseDecryptedDir)) {
        decryptFolderRecursive(courseEncryptedDir, courseDecryptedDir);
        /* it is use to remove folder*/
        // fs.rmSync(courseDecryptedDir, { recursive: true, force: true });
      }


      return courseDecryptedDir;

    } catch (err) {
      console.error("Decryption failed:", err);
      throw err;
    }
  });

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
    const usbPath = findUSBDrivePath();
    if (!usbPath) {
      console.log("No USB drive detected.");
    } else {
      console.log("USB drive path:", usbPath);
      /*we updated global variable  encryptedPath*/
      encryptedPath = path.join(usbPath, 'Rieter/encryptFolder');
      /*check is path is exsit or not*/
      if(!fs.existsSync(encryptedPath)){
        dialog.showErrorBox("Fail to varify content path","please connect with admin");
        app.quit();

      }
      console.log("Encrypted folder:", encryptedPath);
    }
  
  



  // Step 2: get serial number list of all available pen Drive
  let result = await getUSBSerials();
  if (!result.length) {
    dialog.showErrorBox("Access Denied", "Could not verify USB drive.");
    app.quit();
    return;
  }
  // Step 3: send serial number to server to check is it is valide and  not expire pendrive by  `net
  let allowedSerials = {};
  try {
    allowedSerials = await getAllowedSerials({ serialNumber: result });
  } catch (err) {
    console.log("err", err);
    dialog.showErrorBox("Network Error", "Failed to verify license. Please connect to the internet.");
    app.quit();
    return;
  }

  // Step 4: on the bases of allowedSerials check whether user can allow to view content or quit app
  if (!allowedSerials?.valid) {
    dialog.showErrorBox("Fail to varify", allowedSerials?.message ?? "");
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

  try {
    if (platform === 'darwin') {
      // macOS: USB drives are mounted under /Volumes
      const volumes = fs.readdirSync('/Volumes');
      for (const name of volumes) {
        if (name !== 'Macintosh HD') {
          const fullPath = path.join('/Volumes', name);
          if (fs.existsSync(fullPath)) {
            return fullPath;
          }
        }
      }
    }

    if (platform === 'win32') {
      // Windows: DriveType=2 is removable drive
      const output = execSync(`wmic logicaldisk where "drivetype=2" get deviceid`, { encoding: 'utf8' });
      const lines = output.split('\n').map(line => line.trim()).filter(Boolean);
      const deviceIds = lines.filter(line => /^[A-Z]:/.test(line));
      if (deviceIds.length > 0) {
        return deviceIds[0] + '\\'; // Return first removable drive (e.g. "E:\\")
      }
    }

    if (platform === 'linux') {
      // Linux: USB drives are often mounted under /media or /mnt
      const baseDirs = ['/media', '/mnt', '/run/media'];
      for (const base of baseDirs) {
        if (fs.existsSync(base)) {
          const entries = fs.readdirSync(base);
          if (entries.length) {
            return path.join(base, entries[0]); // e.g., /media/username/USB_DRIVE
          }
        }
      }
    }

  } catch (err) {
    console.error("Error finding USB path:", err);
  }

  return null; // USB not found
}

