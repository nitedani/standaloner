const id = pkg => `${pkg.name}@${pkg.version}`;
module.exports = id(require('changing/package.json')) + '+' + id(require('fixed/package.json'));
