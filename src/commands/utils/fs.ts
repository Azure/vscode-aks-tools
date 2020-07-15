const util = require('util');
const sysfs = require('fs');

export const fs = {
    copyFile: util.promisify(sysfs.copyFile),
    exists: util.promisify(sysfs.exists),
    mkdir: util.promisify(sysfs.mkdir),
    readFile: util.promisify(sysfs.readFile),
    writeFile: util.promisify(sysfs.writeFile),
};