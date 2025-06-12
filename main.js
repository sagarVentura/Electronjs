
const { app, BrowserWindow, dialog, net,ipcMain } = require('electron');
const path = require('path');
const { getDiskInfoSync } = require('node-disk-info');
const { exec } = require('child_process');
const os = require('os');

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
      devTools: false,
    }
  });


  // Disable right-click
  win.webContents.on('context-menu', (e) => e.preventDefault());

  win.webContents.openDevTools(); // Opens DevTools automatically

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

 let result= await getUSBSerials();

 console.log("result",result)


  if (!result.length) {
    dialog.showErrorBox("Access Denied", "Could not verify USB drive.");
    app.quit();
    return;
  }

  // Step 3: Fetch allowed serials from server using `net
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
       
let varify= result.some((serialNumber)=>{return allowedSerials.includes(serialNumber)});
console.log("varify",varify,allowedSerials)
  if (!varify) {
    dialog.showErrorBox("Unauthorized USB", "This device is not authorized to run this app.");
    app.quit();
    return;
  }

  // Step 5: Launch app
  createWindow();
});

