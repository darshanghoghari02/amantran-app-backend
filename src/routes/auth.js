import express from 'express';
import { dbService } from '../services/db.js';

const router = express.Router();

// Check if Twilio is configured
const isTwilioConfigured = () => {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_NUMBER);
};

// Check if Meta WhatsApp is configured
const isMetaWhatsappConfigured = () => {
  const token = process.env.META_WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  const template = process.env.META_WHATSAPP_TEMPLATE_NAME;
  
  return !!(
    token && token !== 'your_access_token_here' &&
    phoneId && phoneId !== 'your_phone_number_id_here' &&
    template && template !== 'your_approved_template_name_here'
  );
};

// Helper to generate 6-digit OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Helper to check if OTP is expired (5 minutes)
function isOTPExpired(createdAt) {
  const now = new Date();
  const otpTime = new Date(createdAt);
  const diffInMinutes = (now - otpTime) / (1000 * 60);
  return diffInMinutes > 5;
}

// POST /api/auth/send-whatsapp-otp
// Sends OTP to WhatsApp and stores it in database
router.post('/send-whatsapp-otp', async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({ error: 'Phone number and OTP are required.' });
    }

    // Validate phone format (should be +91 followed by 10 digits)
    if (!/^\+91\d{10}$/.test(phone)) {
      return res.status(400).json({ error: 'Invalid phone number format. Use +91XXXXXXXXXX' });
    }

    // Store OTP in database (using otp_codes collection)
    const otpData = {
      phone,
      otp,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 minutes
      isVerified: false
    };

    // Check if there's an existing unverified OTP for this phone
    const existingOtps = await dbService.getAll('otp_codes');
    const existingOtp = existingOtps.find(o => o.phone === phone && !o.isVerified);

    if (existingOtp) {
      // Update existing OTP
      await dbService.update('otp_codes', existingOtp.id, otpData);
    } else {
      // Create new OTP
      await dbService.add('otp_codes', otpData);
    }

    // Send OTP via WhatsApp (supports Meta Cloud API and Twilio)
    if (isMetaWhatsappConfigured()) {
      try {
        const url = `https://graph.facebook.com/v18.0/${process.env.META_WHATSAPP_PHONE_NUMBER_ID}/messages`;
        const formattedPhone = phone.replace(/\+/g, ''); // "+91XXXXXXXXXX" -> "91XXXXXXXXXX"
        const templateName = process.env.META_WHATSAPP_TEMPLATE_NAME;

        const templatePayload = {
          name: templateName,
          language: {
            code: process.env.META_WHATSAPP_TEMPLATE_LANG || 'en_US'
          }
        };

        // Meta's default test template "hello_world" does not accept any parameters/components
        if (templateName !== 'hello_world') {
          let parameters = [];
          if (templateName === 'whtsapp_group_invitaiton') {
            parameters = [
              {
                type: 'text',
                text: 'User'
              },
              {
                type: 'text',
                text: otp
              }
            ];
          } else {
            parameters = [
              {
                type: 'text',
                text: otp
              }
            ];
          }

          const components = [
            {
              type: 'body',
              parameters: parameters
            }
          ];

          // If template has a copy code button (standard Meta Auth template)
          // whtsapp_group_invitaiton is a utility template and does not have buttons
          if (templateName !== 'whtsapp_group_invitaiton' && process.env.META_WHATSAPP_HAS_BUTTON === 'true') {
            components.push({
              type: 'button',
              sub_type: 'url',
              index: '0',
              parameters: [
                {
                  type: 'text',
                  text: otp
                }
              ]
            });
          }

          templatePayload.components = components;
        }

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.META_WHATSAPP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: formattedPhone,
            type: 'template',
            template: templatePayload
          })
        });

        const resData = await response.json();
        if (response.ok) {
          console.log(`✅ WhatsApp OTP sent via Meta Cloud API to ${phone}: ${otp}`);
        } else {
          console.error('❌ Meta WhatsApp API error response:', resData);
        }
      } catch (metaError) {
        console.error('❌ Meta WhatsApp API fetch error:', metaError);
      }
    } else if (isTwilioConfigured()) {
      try {
        const twilio = await import('twilio');
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        
        await client.messages.create({
          from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
          to: `whatsapp:${phone}`,
          body: `Your Amantran verification code is: ${otp}. Valid for 5 minutes. Do not share this code with anyone.`
        });
        
        console.log(`✅ WhatsApp OTP sent to ${phone}: ${otp}`);
      } catch (twilioError) {
        console.error('Twilio error:', twilioError);
        // Continue even if Twilio fails - OTP is stored in database
      }
    } else {
      console.log(`⚠️ Neither Meta nor Twilio WhatsApp is configured - OTP for ${phone}: ${otp}`);
    }

    res.json({
      success: true,
      message: 'OTP sent successfully',
      otp: otp // Return OTP for testing (remove in production)
    });
  } catch (error) {
    console.error('Error sending WhatsApp OTP:', error);
    res.status(500).json({ error: error.message || 'Failed to send OTP' });
  }
});

// POST /api/auth/verify-whatsapp-otp
// Verifies OTP and returns user data or creates new user
router.post('/verify-whatsapp-otp', async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({ error: 'Phone number and OTP are required.' });
    }

    // Get OTP from database
    const otpCodes = await dbService.getAll('otp_codes');
    const otpRecord = otpCodes.find(o => o.phone === phone && o.otp === otp && !o.isVerified);

    if (!otpRecord) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    // Check if OTP is expired
    if (isOTPExpired(otpRecord.createdAt)) {
      return res.status(400).json({ error: 'OTP has expired' });
    }

    // Mark OTP as verified
    await dbService.update('otp_codes', otpRecord.id, { isVerified: true });

    // Check if user exists by phone or email (to prevent duplicates)
    const appUsers = await dbService.getAll('app_users');
    let user = appUsers.find(u => u.phone === phone || u.email === phone);

    if (user) {
      // Update existing user with phone if they logged in with phone
      const updates = {
        lastLoginAt: new Date().toISOString()
      };
      if (!user.phone && phone) {
        updates.phone = phone;
      }
      await dbService.update('app_users', user.id, updates);
    } else {
      // Create new user only if no existing user found
      const newUser = {
        phone,
        provider: 'phone',
        accountStatus: 'active',
        isBlocked: false,
        invitationCount: 0,
        draftsCount: 0,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString()
      };
      const created = await dbService.add('app_users', newUser);
      user = created;
    }

    res.json({
      success: true,
      message: 'OTP verified successfully',
      user: {
        id: user.id,
        phone: user.phone,
        email: user.email,
        name: user.name,
        displayName: user.displayName,
        profilePhoto: user.profilePhoto,
        provider: user.provider,
        accountStatus: user.accountStatus,
        isBlocked: user.isBlocked,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Error verifying WhatsApp OTP:', error);
    res.status(500).json({ error: error.message || 'Failed to verify OTP' });
  }
});

// POST /api/auth/signup
// Complete user profile after OTP verification
router.post('/signup', async (req, res) => {
  try {
    const { userId, name, email, profilePhoto } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required.' });
    }

    // Get existing user
    const user = await dbService.getOne('app_users', userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Validate unique email
    if (email) {
      const targetEmail = email.toLowerCase().trim();
      if (targetEmail && targetEmail !== 'user@example.com') {
        const results = await dbService.getByField('app_users', 'email', targetEmail);
        const emailExists = results.some(u => (u.id !== userId && u.uid !== userId));
        if (emailExists) {
          return res.status(400).json({ error: 'This email address is already registered with another account.' });
        }
      }
    }

    // Update user profile
    const updates = {};
    if (name) updates.name = name;
    if (name) updates.displayName = name;
    if (email) updates.email = email;
    if (profilePhoto) updates.profilePhoto = profilePhoto;

    const updated = await dbService.update('app_users', userId, updates);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: updated
    });
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ error: error.message || 'Failed to update profile' });
  }
});

// POST /api/auth/google-login
// Handle Google authentication (no OTP required)
router.post('/google-login', async (req, res) => {
  try {
    const { uid, email, name, photoURL, idToken } = req.body;

    if (!uid || !email) {
      return res.status(400).json({ error: 'UID and email are required.' });
    }

    // Check if user exists by email, uid, or phone (to prevent duplicates)
    const appUsers = await dbService.getAll('app_users');
    let user = appUsers.find(u => u.email === email || u.id === uid);

    if (user) {
      // Update existing user with Google data
      const updates = {
        lastLoginAt: new Date().toISOString()
      };
      if (!user.email && email) updates.email = email;
      if (!user.name && name) {
        updates.name = name;
        updates.displayName = name;
      }
      if (!user.profilePhoto && photoURL) updates.profilePhoto = photoURL;
      if (!user.provider) updates.provider = 'google';
      
      await dbService.update('app_users', user.id, updates);
    } else {
      // Create new user only if no existing user found
      const newUser = {
        id: uid,
        email,
        name: name || 'Google User',
        displayName: name || 'Google User',
        profilePhoto: photoURL || '',
        provider: 'google',
        accountStatus: 'active',
        isBlocked: false,
        invitationCount: 0,
        draftsCount: 0,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString()
      };
      const created = await dbService.add('app_users', newUser);
      user = created;
    }

    res.json({
      success: true,
      message: 'Google login successful',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        displayName: user.displayName,
        profilePhoto: user.profilePhoto,
        phone: user.phone,
        provider: user.provider,
        accountStatus: user.accountStatus,
        isBlocked: user.isBlocked,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Error handling Google login:', error);
    res.status(500).json({ error: error.message || 'Failed to process Google login' });
  }
});

// POST /api/auth/apple-login
// Handle Apple authentication (no OTP required)
router.post('/apple-login', async (req, res) => {
  try {
    const { uid, email, name, photoURL, idToken } = req.body;

    if (!uid) {
      return res.status(400).json({ error: 'UID is required.' });
    }

    // Check if user exists by email, uid, or phone (to prevent duplicates)
    const appUsers = await dbService.getAll('app_users');
    let user = appUsers.find(u => u.id === uid || (email && u.email === email));

    if (user) {
      // Update existing user with Apple data
      const updates = {
        lastLoginAt: new Date().toISOString()
      };
      if (!user.email && email) updates.email = email;
      if (!user.name && name) {
        updates.name = name;
        updates.displayName = name;
      }
      if (!user.profilePhoto && photoURL) updates.profilePhoto = photoURL;
      if (!user.provider) updates.provider = 'apple';
      
      await dbService.update('app_users', user.id, updates);
    } else {
      // Create new user only if no existing user found
      const newUser = {
        id: uid,
        email: email || '',
        name: name || 'Apple User',
        displayName: name || 'Apple User',
        profilePhoto: photoURL || '',
        provider: 'apple',
        accountStatus: 'active',
        isBlocked: false,
        invitationCount: 0,
        draftsCount: 0,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString()
      };
      const created = await dbService.add('app_users', newUser);
      user = created;
    }

    res.json({
      success: true,
      message: 'Apple login successful',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        displayName: user.displayName,
        profilePhoto: user.profilePhoto,
        phone: user.phone,
        provider: user.provider,
        accountStatus: user.accountStatus,
        isBlocked: user.isBlocked,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Error handling Apple login:', error);
    res.status(500).json({ error: error.message || 'Failed to process Apple login' });
  }
});

export default router;
