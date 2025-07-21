#!/usr/bin/env python3

import subprocess
import json
import re
import os
from datetime import datetime
from functools import wraps
from flask import Flask, jsonify, request, abort
from flask_cors import CORS
from cryptography import x509
from cryptography.hazmat.backends import default_backend
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# --- Configuration ---
# The host and port the agent will listen on.
# '0.0.0.0' makes it accessible from any IP address.
# For better security, you could change this to '127.0.0.1' and use Nginx
# as a reverse proxy if you want to expose it publicly.
HOST = '0.0.0.0'
PORT = 9797

# The path to your Nginx configuration files.
NGINX_SITES_ENABLED_PATH = '/etc/nginx/sites-enabled'

# --- IMPORTANT: Set your secret password here ---
SECRET_PASSWORD = os.getenv('SECRET_PASSWORD', 'your-super-secret-password')

# --- Flask App Initialization ---
app = Flask(__name__)
# Enable Cross-Origin Resource Sharing (CORS) to allow the frontend
# JavaScript to make requests to this agent.
# Add 'X-Auth-Token' to the list of allowed headers for CORS
CORS(app, expose_headers=['X-Auth-Token'])


# --- Security Decorator ---
def require_auth(f):
    """A decorator to protect routes with password authentication."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Get the password from the request header
        provided_password = request.headers.get('X-Auth-Token')
        if not provided_password or provided_password != SECRET_PASSWORD:
            # If the password is wrong or missing, abort with a 401 Unauthorized error
            abort(401, description="Authentication required.")
        return f(*args, **kwargs)
    return decorated_function


# --- Data Collection Functions ---

def get_docker_containers():
    """
    Fetches details for all Docker containers using 'docker inspect'.
    
    This method is more robust as 'docker inspect' provides full details,
    including labels and the full image ID, in a proper JSON array format.
    
    It also determines a 'solution' for each container (e.g., 'appwrite', 'mailcow')
    based on Docker labels or container names, which the frontend uses for grouping.
    """
    try:
        # 1. Get all container IDs (quiet mode, all containers)
        id_command = ["docker", "ps", "-aq"]
        id_result = subprocess.run(id_command, capture_output=True, text=True, check=True)
        
        # Exit early if there are no containers
        container_ids_str = id_result.stdout.strip()
        if not container_ids_str:
            return []
        container_ids = container_ids_str.split('\n')

        # 2. Inspect all containers at once to get full details in a single JSON array
        inspect_command = ["docker", "inspect"] + container_ids
        inspect_result = subprocess.run(inspect_command, capture_output=True, text=True, check=True)
        
        inspected_data = json.loads(inspect_result.stdout)
        
        containers = []
        for data in inspected_data:
            # --- Format Port Bindings into a simple list of strings ---
            port_bindings = data.get("HostConfig", {}).get("PortBindings", {})
            ports = []
            if port_bindings:
                for container_port, host_bindings in port_bindings.items():
                    if host_bindings:
                        for binding in host_bindings:
                            host_port = binding.get("HostPort", "")
                            # Format as "HostPort:ContainerPort"
                            ports.append(f"{host_port}:{container_port.split('/')[0]}")

            # --- Determine the solution/group for the container ---
            solution = "standalone"
            labels = data.get("Config", {}).get("Labels", {})
            compose_project = labels.get("com.docker.compose.project")
            
            if compose_project:
                solution = compose_project
            else:
                # Fallback to checking the container name for known prefixes
                container_name = data.get("Name", "").lstrip('/')
                known_solutions = ["mailcow", "appwrite"] # This list can be expanded
                for s in known_solutions:
                    if container_name.startswith(s + '_') or container_name.startswith(s + '-'):
                        solution = s
                        break
            
            # --- Format the final container object for the frontend ---
            containers.append({
                "id": data.get("Id", ""),
                "name": data.get("Name", "").lstrip('/'),
                "status": data.get("State", {}).get("Status", "unknown"),
                "image": data.get("Config", {}).get("Image", "unknown"),
                "ports": sorted(ports), # Sort ports for consistent ordering
                "created": data.get("Created", ""),
                "command": ' '.join(data.get("Config", {}).get("Cmd", []) or []),
                "imageId": data.get("Image", ""), # This is the full Image SHA from inspect
                "solution": solution # Add the solution key for the frontend
            })
            
        return containers
    except (subprocess.CalledProcessError, FileNotFoundError, json.JSONDecodeError) as e:
        print(f"Error getting Docker containers: {e}")
        return []


def get_firewall_rules():
    """
    Fetches the current UFW (Uncomplicated Firewall) status and rules.
    
    Parses the output of 'sudo ufw status' to get allowed and blocked ports.
    This function has been updated to handle various UFW output formats,
    including rules with 'LIMIT' and IPv6 notations.
    """
    rules = {"allowed": [], "blocked": []}
    try:
        # Command to get the UFW status.
        command = ["ufw", "status"]
        result = subprocess.run(command, capture_output=True, text=True, check=True)
        print(result)
        print("hi")
        # This improved regex captures the full port/protocol description and the action.
        # It handles 'ALLOW', 'DENY', and 'LIMIT', as well as complex port names like '22/tcp' or '80 (v6)'.
        rule_pattern = re.compile(r"^(.+?)\s+(ALLOW|DENY|LIMIT)\s+")
        
        for line in result.stdout.split('\n'):
            match = rule_pattern.search(line.strip())
            if match:
                # The full port description (e.g., '22/tcp', '80 (v6)')
                port = match.group(1).strip() 
                # The action (e.g., 'ALLOW', 'DENY', 'LIMIT')
                action = match.group(2)
                
                if action == "ALLOW" or action == "LIMIT":
                    # Treat 'LIMIT' as a type of 'ALLOW' for the dashboard
                    if port not in rules["allowed"]:
                        rules["allowed"].append(port)
                elif action == "DENY":
                    if port not in rules["blocked"]:
                        rules["blocked"].append(port)
        return rules
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        print(f"Error getting firewall rules: {e}")
        # Return empty lists if UFW is not installed or an error occurs.
        return {"allowed": [], "blocked": []}

def get_ssl_details(cert_path):
    """
    Reads an SSL certificate file and extracts its issuer and expiry date.
    
    Args:
        cert_path (str): The absolute path to the SSL certificate file.
    
    Returns:
        A dictionary with SSL details or None if the cert can't be read.
    """
    try:
        with open(cert_path, "rb") as cert_file:
            cert_data = cert_file.read()
        
        cert = x509.load_pem_x509_certificate(cert_data, default_backend())
        
        # Extract issuer and expiry date.
        issuer = cert.issuer.get_attributes_for_oid(x509.NameOID.COMMON_NAME)[0].value
        expiry_date = cert.not_valid_after
        days_left = (expiry_date - datetime.now()).days
        
        return {
            "issuer": issuer,
            "expiry": expiry_date.strftime("%Y-%m-%d"),
            "daysLeft": days_left,
            "valid": "Let's Encrypt" in issuer or "R3" in issuer # Simple check for valid CA
        }
    except Exception as e:
        print(f"Could not read SSL cert at {cert_path}: {e}")
        return {
            "issuer": "Unknown/Error",
            "expiry": "N/A",
            "daysLeft": 0,
            "valid": False
        }

def get_nginx_proxies():
    """
    Parses Nginx configuration files to find reverse proxy settings.
    
    Scans files in the NGINX_SITES_ENABLED_PATH for 'server_name', 'proxy_pass',
    and 'ssl_certificate' directives.
    """
    proxies = []
    if not os.path.isdir(NGINX_SITES_ENABLED_PATH):
        print(f"Nginx config directory not found at {NGINX_SITES_ENABLED_PATH}")
        return []

    for config_file in os.listdir(NGINX_SITES_ENABLED_PATH):
        config_path = os.path.join(NGINX_SITES_ENABLED_PATH, config_file)
        try:
            with open(config_path, 'r') as f:
                content = f.read()
                
                # Regex to find server_name, proxy_pass, and ssl_certificate.
                server_name_match = re.search(r"server_name\s+([^;]+);", content)
                proxy_pass_match = re.search(r"proxy_pass\s+([^;]+);", content)
                ssl_cert_match = re.search(r"ssl_certificate\s+([^;]+);", content)
                
                if server_name_match and proxy_pass_match:
                    domain = server_name_match.group(1).strip()
                    target = proxy_pass_match.group(1).strip()
                    ssl_details = {}

                    if ssl_cert_match:
                        cert_path = ssl_cert_match.group(1).strip()
                        # Ensure the path is absolute.
                        if not os.path.isabs(cert_path):
                            cert_path = os.path.join('/etc/nginx', cert_path)
                        ssl_details = get_ssl_details(cert_path)
                    else:
                        ssl_details = { "issuer": "None", "expiry": "N/A", "daysLeft": 0, "valid": False }

                    proxies.append({
                        "domain": domain,
                        "target": target,
                        "ssl": ssl_details,
                        "status": "active" # Assuming active if configured
                    })
        except Exception as e:
            print(f"Error parsing Nginx config {config_file}: {e}")
            
    return proxies


# --- Flask API Endpoint ---

@app.route('/api/v1/stats', methods=['GET'])
@require_auth
def get_all_stats():
    """
    The main API endpoint that gathers all data and returns it as a single
    JSON object.
    """
    print(f"Authenticated Request received for /api/v1/stats at {datetime.now()}")
    
    # Gather all data from the helper functions.
    docker_data = get_docker_containers()
    firewall_data = get_firewall_rules()
    nginx_data = get_nginx_proxies()
    
    # Assemble the final JSON response in the format expected by the frontend.
    response_data = {
        "docker_containers": docker_data,
        "firewall_rules": firewall_data,
        "nginx_proxies": nginx_data
    }
    
    return jsonify(response_data)

# --- Main Execution ---

if __name__ == '__main__':
    """
    The entry point of the script. Starts the Flask web server.
    """
    print(f"Starting VPS Monitoring Agent on http://{HOST}:{PORT}")
    # The 'debug=True' option provides detailed error messages in the browser,
    # which is helpful during development. You should turn this off for production.
    app.run(host=HOST, port=PORT, debug=True)
