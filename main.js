const { app, BrowserWindow, dialog, net } = require('electron');
const path = require('path');
const { getDiskInfoSync } = require('node-disk-info');

// Enable hot reload during development (optional)
try {
  require('electron-reload')(path.join(__dirname), {
    electron: path.join(__dirname, 'node_modules', '.bin', 'electron')
  });
} catch (_) {
  console.log('Error enabling electron-reload');
}

// Function to get allowed serial numbers from server using `net`
function getAllowedSerials() {
  return new Promise((resolve, reject) => {
    const request = net.request({
      method: 'GET',
      protocol: 'https:',
      hostname: 'dhioo.venturaelearning.com',
      path: '/api/organisation/serialnumber'
    });

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
          reject(new Error("Failed to parse server response"));
        }
      });
    });

    request.on('error', (error) => {
      reject(error);
    });

    request.end();
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
    }
  });

  // Disable right-click
  win.webContents.on('context-menu', (e) => e.preventDefault());

  win.webContents.openDevTools(); // Opens DevTools automatically

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
  // Step 1: Get the drive where the app is running
  const appPath = app.getAppPath();        // e.g. D:\MyApp\resources\app.asar
  console.log("appPath", appPath);
  const appDrive = appPath.substring(0, 3); // e.g. D:\

  // Step 2: Get USB serial number (disabled for now, uncomment if needed)
  // let localSerial = null;
  // try {
  //   const disks = getDiskInfoSync();
  //   console.log("disks", disks);
  //   const currentDisk = disks.find(disk => disk.mounted.toUpperCase() === appDrive.toUpperCase());
  //   if (currentDisk) {
  //     localSerial = currentDisk.serial;
  //   }
  // } catch (err) {
  //   console.error("Disk check failed:", err);
  // }

  // if (!localSerial) {
  //   dialog.showErrorBox("Access Denied", "Could not verify USB drive.");
  //   app.quit();
  //   return;
  // }

  // Step 3: Fetch allowed serials from server using `net`
  let allowedSerials = [];
  try {
    allowedSerials = await getAllowedSerials();
    console.log("allowedSerials", allowedSerials);
  } catch (err) {
    console.log("err", err);
    dialog.showErrorBox("Network Error", "Failed to verify license. Please connect to the internet.",err);
    app.quit();
    return;
  }

  // Step 4: Verify serial (disabled for now)
  // if (!allowedSerials.includes(localSerial.toUpperCase())) {
  //   dialog.showErrorBox("Unauthorized USB", "This device is not authorized to run this app.");
  //   app.quit();
  //   return;
  // }

  // Step 5: Launch app
  createWindow();
});
