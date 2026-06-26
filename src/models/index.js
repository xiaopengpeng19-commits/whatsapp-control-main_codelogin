
const Contact = require('./Contact');
const Group = require('./Group');
const Message = require('./Message');
const Account = require('./Account');

// Define model associations
Account.hasMany(Contact, { foreignKey: 'accountId' });
Contact.belongsTo(Account, { foreignKey: 'accountId' });

Account.hasMany(Group, { foreignKey: 'accountId' });
Group.belongsTo(Account, { foreignKey: 'accountId' });

Account.hasMany(Message, { foreignKey: 'accountId' });
Message.belongsTo(Account, { foreignKey: 'accountId' });

// Export all models
module.exports = {
  Contact,
  Group,
  Message,
  Account
}; 