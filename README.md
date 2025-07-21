# VPS Monitoring Dashboard

A simple, self-hosted, at-a-glance dashboard to monitor the status of key services on your VPS. It consists of a lightweight Python (Flask) backend agent that runs on the server and a clean HTML/JS/Tailwind CSS frontend that displays the data.

![Dashboard Screenshot](https://i.imgur.com/your-screenshot-url.png) <!-- Replace with a URL to a screenshot of our dashboard -->

---

## Features

- **Docker Container Monitoring**: View all containers, grouped by solution (e.g., `appwrite`, `mailcow`, `standalone`). See their status, image, and exposed ports.
- **Firewall Status**: See a list of all `ALLOW` and `DENY` rules from UFW (Uncomplicated Firewall).
- **Nginx Reverse Proxies**: Lists all configured reverse proxies from your Nginx `sites-enabled` directory.
- **SSL Certificate Status**: For each Nginx proxy, it checks the associated SSL certificate and displays its validity and days until expiry.
- **Secure Access**: The dashboard is protected by a password prompt, with the secret managed via a `.env` file on the server.
- **Auto-Refresh**: A simple refresh button to fetch the latest data from the agent.

---

## Prerequisites

Before you begin, ensure you have the following installed on your VPS:

-   **Python 3** and `pip`
-   **Docker**
-   **UFW** (Uncomplicated Firewall)
-   **Nginx**

---

## Setup and Installation

Follow these steps to get your monitoring dashboard up and running on your VPS.

### 1. Clone the Repository

First, clone this project into a directory of your choice.

```bash
git clone <your-repo-url>
cd <your-repo-name>
```

### 2. Backend Setup

The backend consists of the Python agent that collects and serves the data.

#### a. Create a Virtual Environment

Navigate into the `backend` directory and create a Python virtual environment.

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
```

#### b. Install Dependencies

Install the required Python libraries using the `requirements.txt` file.

```bash
pip install -r requirements.txt
```

#### c. Configure the Agent

Create a `.env` file in the `backend` directory. This file will hold your secret password.

```bash
# Make sure you are in the 'backend' directory
nano .env
```

Add the following line to the file, replacing the placeholder with a strong, unique password:

```
SECRET_PASSWORD=your-super-secret-password
```

Save and exit the file.

### 3. Create and Enable the `systemd` Service

To ensure the agent runs continuously in the background and starts on reboot, we will set it up as a `systemd` service.

#### a. Create the Service File

Create a new service file using a text editor like `nano`.

```bash
sudo nano /etc/systemd/system/vps-agent.service
```

#### b. Add Service Configuration

Paste the following configuration into the file. **You must replace the placeholder paths** with the absolute paths to your project directory.

```ini
[Unit]
Description=VPS Monitoring Agent
After=network.target

[Service]
# The WorkingDirectory should point to your 'backend' subfolder
WorkingDirectory=/home/your_username/path/to/project/backend

# The ExecStart path must also point to the python executable inside your venv
ExecStart=/home/your_username/path/to/project/backend/venv/bin/python /home/your_username/path/to/project/backend/agent.py
Restart=always

[Install]
WantedBy=multi-user.target
```

**Important:**
-   Replace `/home/your_username/path/to/project` with the actual path to where you cloned the repository.
-   The service will run as the `root` user by default, which is necessary for the agent to access Docker and UFW information without password prompts.

#### c. Start and Enable the Service

Reload the `systemd` daemon, then start and enable your new service.

```bash
sudo systemctl daemon-reload
sudo systemctl start vps-agent
sudo systemctl enable vps-agent
```

You can check the status to ensure it's running correctly:

```bash
sudo systemctl status vps-agent
```

### 4. Frontend Configuration

The frontend files (`index.html`, `script.js`, `style.css`) are located in the `frontend/live` directory. You need to configure the `script.js` file to point to your agent's API.

#### a. Edit `script.js`

Open the `frontend/live/script.js` file and update the `API_URL` variable.

```javascript
// --- Configuration ---
// IMPORTANT: Replace <YOUR_VPS_IP> with the actual IP address of your server.
const API_URL = 'http://<YOUR_VPS_IP>:9999/api/v1/stats';
```

Replace `<YOUR_VPS_IP>` with your server's public IP address. If you are accessing the dashboard from the same server, you can use `http://127.0.0.1:9999/api/v1/stats`.

### 5. Access Your Dashboard

You're all set! To view the dashboard, simply open the `frontend/live/index.html` file in your web browser. When prompted, enter the `SECRET_PASSWORD` you set in the `.env` file.

---

## Project Structure

```
.
├── backend/
│   ├── venv/
│   ├── .env                # Holds the secret password (not committed to git)
│   ├── agent.py            # The Python Flask agent
│   └── requirements.txt    # Backend dependencies
│
└── frontend/
    └── live/
        ├── index.html      # The main dashboard page
        ├── script.js       # Frontend logic and API calls
        └── styles.css      # Custom styles
```

---

## Security Note

The password protection is a basic authentication layer. For enhanced security, consider placing the agent behind a reverse proxy (like Nginx) and adding SSL encryption. Ensure your VPS firewall is configured to only allow access to port `9999` from trusted IP addresses if necessary.
