# Deploy ARIA to Railway

Railway provides automatic HTTPS, environment variable management, and deploys directly from your Git repository.

## Method 1: One-Click Deploy (Recommended - 2 minutes)

Click this button to deploy instantly:

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/xLWXPE?referralCode=alphasec)

This will:
1. Fork the repo to your GitHub account (or deploy directly)
2. Create a new Railway project
3. Deploy the app automatically

After clicking:
1. Sign in to Railway with GitHub
2. Click "Deploy Now"
3. Once deployed, click on your service
4. Go to **Variables** tab and add your API keys:
   - `GEMINI_API_KEY`
   - `GEMINI_MODEL`
   - `GEMINI_PROVIDER`
   - `GCP_PROJECT`
   - `GCP_LOCATION`
   - `ELEVENLABS_API_KEY`
   - `ELEVENLABS_VOICE_ID`
5. Go to **Settings** → **Networking** → **Generate Domain**
6. Done! Visit your URL

## Method 2: Manual Setup (5 minutes)

### 1. Push to GitHub

If you haven't already, initialize git and push to GitHub:

```bash
git add .
git commit -m "Prepare for Railway deployment"
git push
```

If you need to create a new repo:
```bash
# Initialize git (if not done)
git init
git add .
git commit -m "Initial commit"

# Create repo on GitHub, then:
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git branch -M main
git push -u origin main
```

### 2. Deploy on Railway

1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click **"New Project"**
3. Select **"Deploy from GitHub repo"**
4. Choose your `durhack-2026` repository
5. Railway will auto-detect Node.js and start deploying

### 3. Add Environment Variables

In the Railway dashboard, go to your project:

1. Click on your service
2. Go to the **Variables** tab
3. Click **"+ New Variable"** and add each one:

```
GEMINI_API_KEY=AIzaSyAb8RN6IR8q5I_O40L2Y9FYDCaDEq8QBLd1DvgOVP1yExmIoVYA
GEMINI_MODEL=gemini-2.0-flash-exp
GEMINI_PROVIDER=vertex
GCP_PROJECT=gen-lang-client-0795059352
GCP_LOCATION=global
ELEVENLABS_API_KEY=sk_7456ed7cf25ff0ad7d325af066c61319185df1bb198be294
ELEVENLABS_VOICE_ID=O4fnkotIypvedJqBp4yb
HOST=0.0.0.0
PORT=8200
```

4. Click **"Deploy"** to restart with the new variables

### 4. Get Your URL

1. In the Railway dashboard, go to **Settings** tab
2. Scroll to **Networking**
3. Click **"Generate Domain"**
4. Your app will be available at: `https://your-app.up.railway.app`

### 5. Test It

Open these URLs (replace with your Railway domain):

- `https://your-app.up.railway.app/` - Main simulation
- `https://your-app.up.railway.app/editor.html` - Building editor
- `https://your-app.up.railway.app/live.html` - Live device nodes

All devices can now use cameras since Railway provides HTTPS automatically!

## Updating

Every time you push to your GitHub repo, Railway automatically redeploys:

```bash
git add .
git commit -m "Update feature"
git push
```

## Cost

- **Free tier**: 500 hours/month (enough for development/demo)
- **Hobby plan**: $5/month for unlimited hours
- No credit card required for the free tier

## Troubleshooting

### Check Logs
In Railway dashboard → your service → **Deployments** tab → click latest deployment → **View Logs**

### Check Build
If deployment fails, check the **Build Logs** to see what went wrong

### Environment Variables
Make sure all variables are set correctly in the **Variables** tab

### Port Binding
Railway automatically sets the `PORT` environment variable. Our app uses it correctly with:
```javascript
const PORT = Number(process.env.PORT ?? 8200);
```

## Alternative: Deploy Button

You can also create a one-click deploy button by adding this to your README:

```markdown
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/YOUR_USERNAME/YOUR_REPO)
```

## Support

- Railway Docs: https://docs.railway.app/
- Railway Discord: https://discord.gg/railway
