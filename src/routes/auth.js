import express from 'express';
import { dbService } from '../services/db.js';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';

const router = express.Router();

// Google OAuth2 client for ID token verification
const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID || '6374728923-.apps.googleusercontent.com'
);

// JWT secret key (should be in environment variables in production)
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Generate JWT token
function generateJWTToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      provider: user.provider
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// Check if Twilio is configured
const isTwilioConfigured = () => {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_NUMBER);
};

// Check if Meta WhatsApp is configured
const isMetaWhatsappConfigured = () => {
  const token = process.env.META_WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  
  return !!(
    token && token !== 'your_access_token_here' &&
    phoneId && phoneId !== 'your_phone_number_id_here'
  );
};

// Helper to normalize phone numbers (convert 10 digits to +91XXXXXXXXXX format)
function normalizePhoneNumber(phone) {
  if (!phone) return '';
  let cleaned = phone.trim().replace(/[\s\-\(\)]/g, '');
  if (/^\d{10}$/.test(cleaned)) {
    return `+91${cleaned}`;
  }
  if (/^91\d{10}$/.test(cleaned)) {
    return `+${cleaned}`;
  }
  if (/^\+\d{10,15}$/.test(cleaned)) {
    return cleaned;
  }
  return cleaned; // return raw if doesn't match standard
}

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
    const { phone } = req.body;
    let otp = req.body.otp;

    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required.' });
    }

    const normalizedPhone = normalizePhoneNumber(phone);

    // Validate phone format (should be +91 followed by 10 digits)
    if (!/^\+91\d{10}$/.test(normalizedPhone)) {
      return res.status(400).json({ error: 'Invalid phone number format. Use +91XXXXXXXXXX or a 10-digit number.' });
    }

    if (!otp) {
      otp = generateOTP();
    }

    // Store OTP in database (using otp_codes collection)
    const otpData = {
      phone: normalizedPhone,
      otp,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 minutes
      isVerified: false
    };

    // Check if there's an existing unverified OTP for this phone
    const existingOtps = await dbService.getAll('otp_codes');
    const existingOtp = existingOtps.find(o => o.phone === normalizedPhone && !o.isVerified);

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
        const apiVersion = process.env.META_WHATSAPP_API_VERSION || 'v21.0';
        const url = `https://graph.facebook.com/${apiVersion}/${process.env.META_WHATSAPP_PHONE_NUMBER_ID}/messages`;
        const formattedPhone = normalizedPhone.replace(/\+/g, ''); // "+91XXXXXXXXXX" -> "91XXXXXXXXXX"
        const templateName = process.env.META_WHATSAPP_TEMPLATE_NAME;

        let requestBody;

        if (!templateName || templateName === 'text' || process.env.META_WHATSAPP_SEND_AS_TEXT === 'true') {
          // Send as direct text message (useful for testing and sandbox numbers)
          requestBody = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: formattedPhone,
            type: 'text',
            text: {
              body: `Your Amantran verification code is: ${otp}. Valid for 5 minutes.`
            }
          };
        } else {
          // Send as template
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
              // whtsapp_group_invitaiton: {{1}} = name, {{2}} = otp
              parameters = [
                { type: 'text', text: 'User' },
                { type: 'text', text: otp }
              ];
            } else if (templateName === 'amantran_ticket_id') {
              // amantran_ticket_id: "Hi {{1}}, welcome to Amantran!" - {{1}} = phone/identifier
              parameters = [
                { type: 'text', text: normalizedPhone }
              ];
            } else {
              // Generic OTP template: {{1}} = otp
              parameters = [
                { type: 'text', text: otp }
              ];
            }

            const components = [
              {
                type: 'body',
                parameters: parameters
              }
            ];

            // If template has a copy code button (standard Meta Auth template)
            if (
              templateName !== 'whtsapp_group_invitaiton' &&
              templateName !== 'amantran_ticket_id' &&
              process.env.META_WHATSAPP_HAS_BUTTON === 'true'
            ) {
              components.push({
                type: 'button',
                sub_type: 'url',
                index: '0',
                parameters: [{ type: 'text', text: otp }]
              });
            }

            templatePayload.components = components;
          }

          requestBody = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: formattedPhone,
            type: 'template',
            template: templatePayload
          };
        }

        console.log('📤 Meta WhatsApp request payload:', JSON.stringify(requestBody, null, 2));

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.META_WHATSAPP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody)
        });

        const resData = await response.json();
        if (response.ok) {
          console.log(`✅ WhatsApp OTP sent via Meta Cloud API to ${normalizedPhone}: ${otp}`);
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
          to: `whatsapp:${normalizedPhone}`,
          body: `Your Amantran verification code is: ${otp}. Valid for 5 minutes. Do not share this code with anyone.`
        });
        
        console.log(`✅ WhatsApp OTP sent to ${normalizedPhone}: ${otp}`);
      } catch (twilioError) {
        console.error('Twilio error:', twilioError);
        // Continue even if Twilio fails - OTP is stored in database
      }
    } else {
      console.log(`⚠️ Neither Meta nor Twilio WhatsApp is configured - OTP for ${normalizedPhone}: ${otp}`);
    }

    res.json({
      success: true,
      message: 'OTP sent successfully'
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

    const normalizedPhone = normalizePhoneNumber(phone);

    // Get OTP from database
    const otpCodes = await dbService.getAll('otp_codes');
    const otpRecord = otpCodes.find(o => o.phone === normalizedPhone && o.otp === otp && !o.isVerified);

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
    let user = appUsers.find(u => u.phone === normalizedPhone || u.email === normalizedPhone);

    if (user) {
      // Update existing user with phone if they logged in with phone
      const updates = {
        lastLoginAt: new Date().toISOString()
      };
      if (!user.phone && normalizedPhone) {
        updates.phone = normalizedPhone;
      }
      await dbService.update('app_users', user.id, updates);
    } else {
      // Check if self-registration is allowed
      const config = await dbService.getOne('settings', 'system_config');
      if (config && config.allowSelfRegistration === false) {
        return res.status(403).json({ error: 'Public registrations are currently disabled by settings.' });
      }
      const defaultRole = (config && config.defaultUserRole) || 'user';

      // Create new user only if no existing user found
      const newUser = {
        phone: normalizedPhone,
        provider: 'phone',
        role: defaultRole,
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

    // Generate JWT token
    const token = generateJWTToken(user);

    res.json({
      success: true,
      token: token,
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
// Handle Google authentication via OAuth 2.0 authorization code exchange (no Firebase needed)
router.post('/google-login', async (req, res) => {
  try {
    const { code, redirectUri, idToken } = req.body;

    let email, name, picture, googleId;

    if (idToken) {
      // Flow A: Native Google Sign-In (verify idToken directly using Google's library)
      const clientId = process.env.GOOGLE_CLIENT_ID;
      if (!clientId) {
        return res.status(500).json({ error: 'Google Client ID not configured on server.' });
      }

      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: clientId,
      });
      const payload = ticket.getPayload();

      googleId = payload.sub;
      email = payload.email;
      name = payload.name;
      picture = payload.picture;
      
      console.log(`✅ Google Native ID Token success for: ${email} (${name})`);
    } else if (code) {
      // Flow B: OAuth 2.0 Web Auth Code exchange
      if (!redirectUri) {
        return res.status(400).json({ error: 'Redirect URI is required.' });
      }

      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        return res.status(500).json({ error: 'Google OAuth credentials not configured on server.' });
      }

      // Step 1: Exchange authorization code for tokens
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });

      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok || tokenData.error) {
        console.error('Token exchange error:', tokenData);
        return res.status(400).json({ error: tokenData.error_description || 'Failed to exchange code for tokens' });
      }

      const { access_token } = tokenData;

      if (!access_token) {
        return res.status(400).json({ error: 'No access token received from Google' });
      }

      // Step 2: Get user info from Google using access token
      const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` },
      });

      const userInfo = await userInfoResponse.json();

      if (!userInfoResponse.ok || !userInfo.email) {
        console.error('User info error:', userInfo);
        return res.status(400).json({ error: 'Failed to get user info from Google' });
      }

      googleId = userInfo.sub;
      email = userInfo.email;
      name = userInfo.name;
      picture = userInfo.picture;

      console.log(`✅ Google OAuth success for: ${email} (${name})`);
    } else {
      return res.status(400).json({ error: 'Either idToken or authorization code is required.' });
    }

    // Step 3: Find or create user in database
    const appUsers = await dbService.getAll('app_users');
    let user = appUsers.find(u => u.email === email || u.google_id === googleId);

    if (user) {
      // Update existing user with Google data
      const updates = { lastLoginAt: new Date().toISOString() };
      if (!user.email && email) updates.email = email;
      if (!user.name && name) { updates.name = name; updates.displayName = name; }
      if (!user.profilePhoto && picture) updates.profilePhoto = picture;
      if (!user.google_id && googleId) updates.google_id = googleId;
      if (!user.provider) updates.provider = 'google';
      await dbService.update('app_users', user.id, updates);
      // Merge updates into user object for response
      user = { ...user, ...updates };
    } else {
      // Check if self-registration is allowed
      const config = await dbService.getOne('settings', 'system_config');
      if (config && config.allowSelfRegistration === false) {
        return res.status(403).json({ error: 'Public registrations are currently disabled by settings.' });
      }
      const defaultRole = (config && config.defaultUserRole) || 'user';

      // Create new user
      const newUser = {
        google_id: googleId,
        email,
        name: name || 'Google User',
        displayName: name || 'Google User',
        profilePhoto: picture || '',
        provider: 'google',
        role: defaultRole,
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

    // Step 4: Generate JWT token
    const token = generateJWTToken(user);

    res.json({
      success: true,
      token,
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
      // Check if self-registration is allowed
      const config = await dbService.getOne('settings', 'system_config');
      if (config && config.allowSelfRegistration === false) {
        return res.status(403).json({ error: 'Public registrations are currently disabled by settings.' });
      }
      const defaultRole = (config && config.defaultUserRole) || 'user';

      // Create new user only if no existing user found
      const newUser = {
        id: uid,
        email: email || '',
        name: name || 'Apple User',
        displayName: name || 'Apple User',
        profilePhoto: photoURL || '',
        provider: 'apple',
        role: defaultRole,
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
