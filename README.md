# 🪷 Amantran Admin Panel — Wedding Invitation CMS

> **Amantran** — A comprehensive Content Management System for creating, managing, and publishing multi-language wedding invitation card templates for the Amantran Flutter mobile app.

---

## 📦 Project Structure

```
amantran_app_admin/
├── backend/                  # Express.js REST API Server
│   ├── server.js             # Main server entry point (Port 5000)
│   ├── db.json               # Local JSON database (flat-file storage)
│   ├── firebase-service-account.json
│   ├── assets/               # Static assets storage
│   │   ├── images/           # Category covers, template backgrounds, stickers
│   │   └── fonts/            # Custom TTF/OTF font files
│   └── src/
│       ├── routes/           # API route handlers
│       │   ├── categories.js
│       │   ├── templates.js
│       │   ├── fonts.js
│       │   ├── languages.js
│       │   ├── users.js
│       │   ├── analytics.js
│       │   └── uploads.js
│       ├── services/
│       │   └── db.js         # Database service (JSON read/write)
│       └── middleware/
│
└── frotend/                  # Next.js 15 Admin Dashboard (TypeScript)
    ├── src/
    │   ├── app/              # Next.js App Router
    │   │   ├── layout.tsx
    │   │   ├── page.tsx      # Main page (renders sidebar + content)
    │   │   └── globals.css
    │   ├── components/       # UI Components
    │   │   ├── Sidebar.tsx
    │   │   ├── Topbar.tsx
    │   │   ├── Dashboard.tsx
    │   │   ├── TemplatesList.tsx
    │   │   ├── Categories.tsx
    │   │   ├── Fonts.tsx
    │   │   ├── Languages.tsx
    │   │   ├── Users.tsx
    │   │   └── editor/       # Canvas-based Template Editor
    │   │       ├── EditorWorkspace.tsx
    │   │       ├── CanvasArea.tsx
    │   │       ├── LeftPanel.tsx
    │   │       ├── RightPanel.tsx
    │   │       └── PreviewModal.tsx
    │   ├── store/
    │   │   └── canvasStore.ts  # Zustand state management
    │   ├── types/
    │   │   └── index.ts       # TypeScript interfaces
    │   └── utils/
    │       └── translate.ts   # Translation utility
    └── tailwind.config.js
```

---

## 🧭 Admin Panel — Navigation Sections

Admin panel mein **6 main sections** hain, sidebar se navigate karte hain:

| # | Section | Description (Hindi) |
|---|---------|---------------------|
| 1 | **Dashboard** | Overview — stats, charts, recent activity |
| 2 | **Templates** | Invitation card templates manage karo |
| 3 | **Categories** | Wedding, Engagement, Baby Shower etc. categories |
| 4 | **Typography & Fonts** | Custom fonts (.ttf/.otf) upload aur manage |
| 5 | **Languages** | Supported languages/locales manage karo |
| 6 | **User Management** | App users dekho, block/unblock karo |

---

## 📊 1. Dashboard

Dashboard pe ye sab dikhta hai:

### Statistics Cards (6 cards)
- **Total Users** — Kitne registered users hain
- **Total Templates** — Kitni invitation templates banayi hain
- **Active Categories** — Kitni categories active hain
- **Premium Invitations** — Kitne premium (paid) templates hain
- **Total Invitations Created** — Users ne kitni invitations banayi hain
- **User Drafts** — Kitne draft invitations saved hain

### Charts
- **Active User Growth** — Monthly registration trend (SVG line chart)
- **Template Distribution** — Category-wise kitne templates hain (SVG bar chart)

### Recent Activity Log
- Latest actions dikhata hai (e.g., template created, user registered)
- Kaun user ne, kab kiya — ye sab info dikhti hai

### Top Templates
- Sabse zyada downloaded templates ki list
- Premium/Free badge ke saath
- Download count dikhta hai

### Quick Action
- **"Add Template"** button — seedha template creation pe le jaata hai

---

## 🎨 2. Templates Management

Ye sabse bada aur important section hai. Isme:

### Template List View
- Saari templates cards ke form mein dikhti hain
- Filter by category (dropdown)
- Har template card pe:
  - Thumbnail preview image
  - Template name & slug
  - Premium/Free badge
  - Active/Inactive status
  - Pages count
  - **Edit** ✏️ — Canvas editor mein open
  - **Duplicate** 📋 — Template ki copy banao
  - **Delete** 🗑️ — Template delete karo
  - **Toggle visibility** 👁️ — Show/hide in app

### Create New Template (Modal Form)
- Template **Name** dena padta hai (slug auto-generate hota hai)
- **Category** select karo (dropdown)
- **Premium / Free** toggle
- **Active / Inactive** toggle
- **Fonts select** karo — multiple fonts choose kar sakte ho
- **Languages select** karo — multiple languages choose kar sakte ho
- **Thumbnail image upload** karo
- **Background images upload** — multi-page backgrounds
- Auto-generates **7 default wedding pages** (agar wedding category hai):
  1. Cover Page — Ganesh sticker, title, couple name, date, invitation text
  2. Welcome Page — Celebration title, blessing text, couple name
  3. Mangal Prasango Page — Ganesh Sthapana, Mandap Muhurat, Grah Shanti events
  4. Sangeet Sandhya Page — Music/dance evening details
  5. Parinay Utsav Page — Wedding ceremony, Hast Melap, feast timing
  6. Family Details Page — Grandfather, parents, uncles ki details
  7. Contact/Thanks Page — RSVP info, phone number

### 🖌️ Template Canvas Editor (Full-Screen)
Ye ek powerful visual editor hai jo template ke pages design karta hai:

#### Editor Toolbar (Top Bar)
- **← Back** — Template list pe wapas
- **Template name & slug** dikhta hai
- **Undo / Redo** (Ctrl+Z / Ctrl+Y)
- **Zoom control** — zoom in/out percentage
- **Autosave status** — "Syncing...", "Saved to Local", "Sync Offline"
- **Language switcher** — dropdown se language change karo
- **Live Preview** button — fullscreen card slideshow preview
- **Save Draft** button — manual save

#### Left Panel (Elements & Pages)
- **Pages list** — Multi-page invitation ke pages dikhte hain
  - Page thumbnail preview
  - Drag to reorder (future)
  - Add new page
  - Delete page
- **Elements list** — Current page ke text/image/sticker elements
- **Add Elements** — New text, image, sticker add karo
- **Sticker library** — Pre-loaded stickers (Ganesh etc.)

#### Canvas Area (Center)
- **Visual drag-and-drop canvas** — 1080×1920 px (mobile invitation size)
- Elements ko **drag** karke move karo
- Elements ko **resize** karo (corner handles se)
- **Rotation** support
- **Background image** dikhta hai
- **Selected element** highlight hota hai
- **Keyboard shortcuts:**
  - `Arrow keys` — 1px nudge
  - `Shift + Arrow` — 10px nudge
  - `Ctrl+D` — Duplicate element
  - `Delete/Backspace` — Delete element

#### Right Panel (Properties Inspector)
- Selected element ki properties edit karo:
  - **Position** (X, Y coordinates)
  - **Size** (Width, Height)
  - **Rotation** (degrees)
  - **Opacity** (0-100%)
  - **Z-Index** (layer order)
  - **Lock/Unlock** toggle
- **Text-specific properties:**
  - Text content (multi-line)
  - Font Family (dropdown — registered fonts se)
  - Font Size
  - Font Weight (Bold/Normal)
  - Text Color (color picker)
  - Text Alignment (Left/Center/Right/Justify)
  - Line Height
  - Letter Spacing
  - **Multi-language translations** — har language ke liye alag text

#### Live Preview Modal
- Full-screen slideshow mode
- Har page one-by-one dikhta hai
- Language switch kar sakte ho preview mein bhi
- Navigation arrows — next/previous page

#### Auto-Translation Feature
- Language dropdown se language change karne pe
- Jo text elements pe translation missing hai unko **Google Translate API** se auto-translate karta hai
- Backend pe proxy endpoint hai (`/api/translate`) — CORS bypass ke liye
- Supported Languages: English, Hindi, Gujarati, Marathi, Tamil, Urdu

---

## 📁 3. Categories Management

### Category Table View
- Table mein columns:
  - **Image** — Category cover visual (thumbnail)
  - **Category Name** — e.g., Wedding, Engagement, Baby Shower, Reception
  - **Slug Path** — folder path slug (e.g., `wedding`, `baby_shower`)
  - **Display Order** — App mein kis order mein dikhna chahiye
  - **Status** — Active ✅ / Disabled ❌
  - **Actions** — Edit ✏️, Delete 🗑️

### Create / Edit Category (Modal Form)
- **Category Name** — naam dalo (slug auto-generate)
- **Folder Slug** — automatic path: `assets/images/{slug}/`
- **Display Sequence** — number order
- **Display State** toggle — Active/Disabled
- **Category Cover Visual** — image upload karo
  - Preview dikhta hai
  - Remove/replace option

### CRUD Operations
- ✅ Add new category
- ✅ Edit existing category
- ✅ Delete category (confirmation dialog)
- ✅ Upload cover image per category

---

## 🔤 4. Typography & Fonts Management

### Font Table View
- Table mein columns:
  - **Font Family** — naam (e.g., Hind Vadodara, KAP011, Rasa, Farsan)
  - **Live Specimen Preview** — actual font mein sample text dikhta hai
  - **Flutter Asset Destination** — `assets/fonts/font_name.ttf` path
  - **Status** — Enabled ✅ / Disabled ❌ (toggle button)
  - **Actions** — Delete 🗑️

### Upload New Font (Modal Form)
- **Font file upload** — Drag & drop ya click se `.ttf` / `.otf` file upload
- **Font Family Name** — auto-fill from filename (ya manually type karo)
- **Saved Asset Path** — automatically generated: `assets/fonts/filename.ttf`
- **Display State** toggle — Active/Disabled

### Features
- ✅ Upload .ttf/.otf font binary files
- ✅ Auto-detect font family name from filename
- ✅ Toggle font active/disabled status (one-click)
- ✅ Delete font record
- ✅ Live specimen preview in table
- ✅ Fonts available in Template Editor font dropdown

---

## 🌐 5. Languages Management

### Language Table View
- Table mein columns:
  - **Language** — naam with globe icon (e.g., English, Hindi, Gujarati, Marathi, Tamil, Urdu)
  - **Locale Code** — ISO code (e.g., `en`, `hi`, `gu`, `mr`, `ta`, `ur`)
  - **Status** — Enabled ✅ / Disabled ❌ (toggle button)
  - **Actions** — Delete 🗑️

### Add New Language (Modal Form)
- **Language Name** — e.g., "Gujarati"
- **Locale ISO Code** — e.g., "gu"
- **Display State** toggle — Active/Disabled

### Features
- ✅ Add new translation locale
- ✅ Toggle language active/disabled status
- ✅ Delete language
- ✅ Languages appear in Template Editor language switcher
- ✅ Languages appear in Template creation form (multi-select)

---

## 👥 6. User Management

### User Table View
- **Search bar** — Name ya email se search karo
- **Role filter** dropdown — All / Super Admin / Editor / Content Manager
- Table mein columns:
  - **User Profile** — Avatar (initials), Display Name, Email
  - **Role** — Color-coded badge:
    - 🔴 Super Admin
    - 🔵 Editor
    - 🟢 Content Manager
    - ⚪ User
  - **Created Invites** — Kitni invitation cards banayi
  - **Total Drafts** — Kitne drafts saved
  - **Account Status** — Good Standing ✅ / Suspended 🚫
  - **Actions:**
    - **Suspend / Activate** toggle button
    - **Delete** 🗑️ — User profile permanently delete (with confirmation)

### Features
- ✅ Search users by name/email
- ✅ Filter by role
- ✅ Block/Unblock user account
- ✅ Delete user profile
- ✅ View invitation & draft counts

---

## 🔌 Backend API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/categories` | Saari categories fetch karo |
| POST | `/api/categories` | New category create karo |
| PUT | `/api/categories/:id` | Category update karo |
| DELETE | `/api/categories/:id` | Category delete karo |
| GET | `/api/templates` | Saari templates fetch karo (filter: `?categoryId=`) |
| POST | `/api/templates` | New template create karo |
| PUT | `/api/templates/:id` | Template update karo (editor save) |
| DELETE | `/api/templates/:id` | Template delete karo |
| GET | `/api/fonts` | Saare fonts fetch karo |
| POST | `/api/fonts` | New font register karo |
| PUT | `/api/fonts/:id` | Font status toggle karo |
| DELETE | `/api/fonts/:id` | Font delete karo |
| GET | `/api/languages` | Saari languages fetch karo |
| POST | `/api/languages` | New language add karo |
| PUT | `/api/languages/:id` | Language status toggle karo |
| DELETE | `/api/languages/:id` | Language delete karo |
| GET | `/api/users` | Users fetch karo (filter: `?query=&role=`) |
| PUT | `/api/users/:id` | User block/unblock karo |
| DELETE | `/api/users/:id` | User delete karo |
| GET | `/api/analytics/summary` | Dashboard stats fetch karo |
| GET | `/api/analytics/charts` | Dashboard chart data fetch karo |
| POST | `/api/uploads/single` | Single file upload (params: `type`, `categorySlug`, `templateSlug`) |
| POST | `/api/uploads/multiple` | Multiple files upload |
| POST | `/api/translate` | Google Translate proxy (CORS bypass) |

---

## 🛠️ Tech Stack

### Frontend
| Technology | Version | Usage |
|------------|---------|-------|
| **Next.js** | 15 | React framework (App Router) |
| **React** | 19 | UI components |
| **TypeScript** | 5.6 | Type safety |
| **Tailwind CSS** | 3.4 | Styling |
| **Zustand** | 5.0 | Canvas editor state management |
| **Framer Motion** | 11 | Animations |
| **Lucide React** | 0.456 | Icon library |
| **React Hook Form** | 7.53 | Form handling |

### Backend
| Technology | Version | Usage |
|------------|---------|-------|
| **Express.js** | 4.19 | REST API server |
| **Firebase Admin** | 12.1 | Firebase integration |
| **Multer** | 1.4 | File upload handling |
| **CORS** | 2.8 | Cross-origin support |

### Database
- **Local JSON file** (`db.json`) — Flat-file JSON database
- Firebase integration available (migration script present)

---

## 🚀 How to Run

### 1. Backend Start
```bash
cd backend
npm install
npm run dev          # nodemon (development — auto-restart)
# OR
npm start            # production mode
```
Backend runs on: `http://localhost:5000`

### 2. Frontend Start
```bash
cd frotend
npm install
npm run dev          # Next.js development server
```
Frontend runs on: `http://localhost:3000`

### 3. Both Saath Mein
Dono terminals mein separately backend aur frontend start karo.

---

## 📋 Design Theme

Admin panel ka design ek **premium wedding aesthetic** follow karta hai:

| Color | Hex | Usage |
|-------|-----|-------|
| Wedding Pink Dark | `#B86B77` | Primary accent, buttons |
| Wedding Pink Medium | `#D4A0A7` | Borders, highlights |
| Wedding Pink Light | `#FAF3F0` | Backgrounds, hover states |
| Wedding Gold Accent | `#D4AF37` | Gold accents, premium badges |
| Wedding Gold Dark | `#B8962E` | Gold hover states |
| Wedding Gold Light | `#E6C280` | Light gold text |
| Wedding Charcoal Dark | `#1E1D1E` | Sidebar, header background |
| Wedding Charcoal Light | `#3D3B3C` | Secondary dark |
| Wedding BG | `#FEFCFA` | Main content background |

---

## 📝 Key Features Summary

- ✅ **Visual Canvas Editor** — Drag & drop template designer (1080×1920 px)
- ✅ **Multi-Page Templates** — Multiple pages per invitation (Cover, Welcome, Events, Family, Thanks)
- ✅ **Multi-Language Support** — 6 languages (English, Hindi, Gujarati, Marathi, Tamil, Urdu)
- ✅ **Auto-Translation** — Google Translate API integration
- ✅ **Custom Font Upload** — .ttf/.otf font binary upload & management
- ✅ **Category Management** — CRUD with cover image upload
- ✅ **User Management** — Search, filter, block/unblock, delete
- ✅ **Dashboard Analytics** — Stats, charts, activity log, top templates
- ✅ **File Upload System** — Single & multi-file upload to organized asset folders
- ✅ **Autosave** — 1.5s debounced autosave in editor
- ✅ **Undo/Redo** — Full undo/redo stack in canvas editor
- ✅ **Keyboard Shortcuts** — Ctrl+Z, Ctrl+Y, Ctrl+D, Delete, Arrow nudge
- ✅ **Live Preview** — Fullscreen slideshow preview with language switching
- ✅ **Premium Wedding Theme** — Beautiful pink & gold admin UI design
- ✅ **Responsive Tables** — All CRUD screens with sortable, filterable tables
- ✅ **Default Template Generation** — Auto-generates 7 wedding card pages with pre-filled content & translations
