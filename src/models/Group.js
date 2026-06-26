const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Group = sequelize.define('Group', {
  id: {
    type: DataTypes.BIGINT,

    primaryKey: true
  },
  accountId: {
    type: DataTypes.BIGINT,
    allowNull: false,
  },
  groupId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  participants: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: []
  },
  settings: {
    type: DataTypes.JSON,
    allowNull: true
  }
}, {
  tableName: 'groups',
  timestamps: true,
  indexes: [
    {
      fields: ['accountId']
    },
    {
      fields: ['groupId']
    }
  ]
});

module.exports = Group;