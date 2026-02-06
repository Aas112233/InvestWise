import mongoose from 'mongoose';

const SystemSettingsSchema = new mongoose.Schema({
    financial: {
        fiscalYearStart: { type: String, default: 'July' },
        baseCurrency: { type: String, default: 'BDT (Bangladeshi Taka)' },
        taxRate: { type: Number, default: 15.0 },
        accountingMethod: { type: String, default: 'Cash' }
    },
    system: {
        language: { type: String, default: 'English' }, // Stored as label or 'en' code? Let's assume label for now to match UI or convert. The UI uses 'English'/'Bengali' labels but logic uses 'en'/'bn'.
        // Better to store 'en' / 'bn' codes.
        // But UI sends 'English'. Let's stick to what UI sends for now and refine later or map it.
        // Actually, the UI passes `lang` ('en'|'bn') to components.
        // The settings UI <FormSelect> options were `['English', 'Bengali']`.
        // Let's store string values.
        refreshInterval: { type: String, default: 'Real-time' },
        theme: { type: String, default: 'System Default' },
        dateFormat: { type: String, default: 'DD/MM/YYYY' },
        isMaintenanceMode: { type: Boolean, default: false }
    },
    lastUpdatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    lastUpdatedAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

// Ensure we only have one settings document
SystemSettingsSchema.statics.getSettings = async function () {
    const settings = await this.findOne();
    if (settings) return settings;
    return await this.create({});
};

const SystemSettings = mongoose.model('SystemSettings', SystemSettingsSchema);
export default SystemSettings;
