const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, required: true },
    email: {type: String, required: true, unique: true},
    password: {type: String, required: true},
    specialties: {type: Array, default: []},
    picture: {type: String, required: true},
    pix: {type: String, required: false},
    scheduledClients: {type: Array, default: []},
    configSchedule: {type: Array, default: []},
    role: {type: String, required: false, default: 'prof'}
   
});


module.exports = mongoose.model('User', UserSchema);