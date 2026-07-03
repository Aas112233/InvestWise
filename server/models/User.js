import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = mongoose.Schema(
 {
 name: {
 type: String,
 required: [true, 'Name is required'],
 trim: true,
 minlength: [2, 'Name must be at least 2 characters'],
 },
 email: {
 type: String,
 required: [true, 'Email is required'],
 unique: true,
 match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email address'],
 lowercase: true,
 trim: true,
 index: true,
 },
 password: {
 type: String,
 required: [true, 'Password is required'],
 },
 role: {
 type: String,
 enum: ['Admin', 'Manager', 'Audit', 'Investor', 'Member'],
 default: 'Member',
 },
 status: {
 type: String,
 enum: ['active', 'suspended', 'inactive'],
 default: 'active',
 index: true,
 },
 permissions: {
 // Allow flexible permissions object
 type: Map,
 of: String,
 default: {},
 },
 lastLogin: {
 type: Date,
 },
 avatar: {
 type: String,
 },
 memberId: {
 type: String,
 }
 },
 {
 timestamps: true,
 }
);

userSchema.methods.matchPassword = async function (enteredPassword) {
 return await bcrypt.compare(enteredPassword, this.password);
};

userSchema.pre('save', async function (next) {
 if (!this.isModified('password')) {
 return next();
 }

 try {
 const salt = await bcrypt.genSalt(10);
 this.password = await bcrypt.hash(this.password, salt);
 next();
 } catch (error) {
 next(error);
 }
});

const User = mongoose.model('User', userSchema);

export default User;
