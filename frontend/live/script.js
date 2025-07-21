// --- Configuration ---
// IMPORTANT: Replace <YOUR_VPS_IP> with the actual IP address of your server.
const API_URL = '/api/v1/stats';

// Global variable to hold the fetched data so it's accessible to all functions
let dashboardData = {};

// --- Helper Functions ---

/**
 * Formats an ISO 8601 date string into a more readable "time ago" format.
 * @param {string} dateString The ISO date string from the API.
 * @returns {string} A human-readable relative time.
 */
function formatTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.round((now - date) / 1000);
    const minutes = Math.round(seconds / 60);
    const hours = Math.round(minutes / 60);
    const days = Math.round(hours / 24);

    if (seconds < 60) return `${seconds} sec ago`;
    if (minutes < 60) return `${minutes} min ago`;
    if (hours < 24) return `${hours} hours ago`;
    return `${days} days ago`;
}

/**
 * Creates a status badge for a container.
 * @param {string} status The status string (e.g., 'running', 'exited').
 * @returns {string} HTML for the badge.
 */
function getStatusBadge(status) {
    if (status.toLowerCase().includes('running') || status.toLowerCase().includes('up')) {
        return '<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">Running</span>';
    } else if (status.toLowerCase().includes('exited') || status.toLowerCase().includes('stopped')) {
        return '<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">Stopped</span>';
    } else {
        return `<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-yellow-100 text-yellow-800">${status}</span>`;
    }
}

/**
 * Creates a badge for an SSL certificate's status.
 * @param {object} ssl The SSL details object from the API.
 * @returns {string} HTML for the badge.
 */
function getSslBadge(ssl) {
    if (!ssl || !ssl.valid) {
        return '<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">Self-signed/Invalid</span>';
    } else if (ssl.daysLeft <= 7) {
        return `<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800 cert-expiry-warning">Expires in ${ssl.daysLeft} days</span>`;
    } else if (ssl.daysLeft <= 30) {
        return `<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-yellow-100 text-yellow-800">Expires in ${ssl.daysLeft} days</span>`;
    } else {
        return `<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">Valid until ${ssl.expiry}</span>`;
    }
}

/**
 * Creates a badge for a firewall port.
 * @param {string} port The port number or description.
 * @param {boolean} isAllowed True if the port is allowed, false if blocked.
 * @returns {string} HTML for the badge.
 */
function getPortBadge(port, isAllowed = true) {
    const color = isAllowed ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
    return `<span class="px-2 py-1 rounded-md text-xs font-medium ${color}">${port}</span>`;
}


// --- Data Population Functions ---

/**
 * Populates the Docker containers table with data from the API.
 * @param {Array} containers The list of container objects.
 */
function populateDockerContainers(containers = []) {
    const containerTable = document.getElementById('docker-containers');
    containerTable.innerHTML = '';

    if (!containers || containers.length === 0) {
        containerTable.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-gray-500">No containers found or could not fetch data.</td></tr>';
        document.getElementById('running-containers').textContent = 0;
        return;
    }

    // Group containers by the 'solution' key provided by the agent
    const groupedContainers = containers.reduce((acc, container) => {
        const solution = container.solution || 'standalone';
        if (!acc[solution]) {
            acc[solution] = [];
        }
        acc[solution].push(container);
        return acc;
    }, {});

    // Create sections for each solution group
    Object.entries(groupedContainers).forEach(([solution, solutionContainers]) => {
        const headerRow = document.createElement('tr');
        headerRow.className = 'bg-gray-50';
        headerRow.innerHTML = `
            <td colspan="5" class="px-6 py-3 text-sm font-medium text-gray-900 uppercase tracking-wider">
                <i class="fas fa-cube mr-2"></i>
                ${solution} (${solutionContainers.length} containers)
            </td>
        `;
        containerTable.appendChild(headerRow);

        solutionContainers.forEach(container => {
            const row = document.createElement('tr');
            row.className = 'hover:bg-gray-50 cursor-pointer border-t border-gray-200';
            row.setAttribute('data-container-id', container.id);
            row.innerHTML = `
                <td class="px-6 py-4 whitespace-nowrap">
                    <div class="flex items-center">
                        <div class="flex-shrink-0 h-10 w-10 flex items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
                            <i class="fab fa-docker"></i>
                        </div>
                        <div class="ml-4">
                            <div class="text-sm font-medium text-gray-900">${container.name}</div>
                            <div class="text-sm text-gray-500">${container.id.substring(0, 12)}</div>
                        </div>
                    </div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                    ${getStatusBadge(container.status)}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <div class="text-sm text-gray-900">${container.image}</div>
                    <div class="text-xs text-gray-500">${container.imageId.substring(0, 12)}</div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <div class="flex flex-wrap gap-1">
                        ${container.ports.map(port => `<span class="px-2 py-1 rounded-md text-xs font-medium bg-blue-100 text-blue-800">${port}</span>`).join('')}
                    </div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button class="text-indigo-600 hover:text-indigo-900 mr-3" title="View Logs"><i class="fas fa-scroll"></i></button>
                    <button class="text-green-600 hover:text-green-900 mr-3" title="Start"><i class="fas fa-play"></i></button>
                    <button class="text-red-600 hover:text-red-900" title="Stop"><i class="fas fa-stop"></i></button>
                </td>
            `;
            containerTable.appendChild(row);
        });
    });

    // Update the summary stat
    const runningCount = containers.filter(c => c.status.toLowerCase().includes('running') || c.status.toLowerCase().includes('up')).length;
    document.getElementById('running-containers').textContent = runningCount;
}

/**
 * Populates the firewall rules section.
 * @param {object} firewallData The firewall rules object from the API.
 */
function populateFirewallRules(firewallData = { allowed: [], blocked: [] }) {
    const allowedPortsDiv = document.getElementById('allowed-ports');
    const blockedPortsDiv = document.getElementById('blocked-ports');

    allowedPortsDiv.innerHTML = firewallData.allowed.map(port => getPortBadge(port, true)).join('') || '<span class="text-xs text-gray-500">No allowed ports found.</span>';
    blockedPortsDiv.innerHTML = firewallData.blocked.map(port => getPortBadge(port, false)).join('') || '<span class="text-xs text-gray-500">No blocked ports found.</span>';

    // Update the summary stat
    const totalRules = (firewallData.allowed.length || 0) + (firewallData.blocked.length || 0);
    document.getElementById('firewall-rules').textContent = totalRules;
}

/**
 * Populates the Nginx reverse proxies table.
 * @param {Array} proxies The list of Nginx proxy objects from the API.
 */
function populateNginxProxies(proxies = []) {
    const nginxTable = document.getElementById('nginx-proxies-list');
    nginxTable.innerHTML = '';

    if (!proxies || proxies.length === 0) {
        nginxTable.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-gray-500">No Nginx proxies found.</td></tr>';
        document.getElementById('nginx-proxies').textContent = 0;
        return;
    }

    proxies.forEach(proxy => {
        const row = document.createElement('tr');
        row.className = 'hover:bg-gray-50';
        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap">
                <div class="text-sm font-medium text-gray-900">${proxy.domain}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                <div class="text-sm text-gray-900">${proxy.target}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                ${getSslBadge(proxy.ssl)}
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                ${getStatusBadge(proxy.status)}
            </td>
        `;
        nginxTable.appendChild(row);
    });

    // Update the summary stat
    document.getElementById('nginx-proxies').textContent = proxies.length;
}

/**
 * Shows the modal with details for a specific Docker container.
 * @param {string} containerId The ID of the container to show.
 */
function showDockerModal(containerId) {
    const container = dashboardData.docker_containers.find(c => c.id === containerId);
    if (!container) return;

    document.getElementById('docker-modal-title').textContent = `${container.name} Details`;
    document.getElementById('container-id').textContent = container.id.substring(0, 12);
    document.getElementById('container-created').textContent = formatTimeAgo(container.created);
    document.getElementById('container-image-id').textContent = container.imageId.replace('sha256:', '').substring(0, 12);
    document.getElementById('container-command').textContent = container.command || 'N/A';
    document.getElementById('container-env').textContent = 'Environment data not currently fetched.'; // Placeholder

    const portsDiv = document.getElementById('container-ports');
    portsDiv.innerHTML = container.ports.map(port => `
        <div class="mt-1">
            <span class="px-2 py-1 rounded-md text-xs font-medium bg-blue-100 text-blue-800">${port}</span>
        </div>
    `).join('') || '<span class="text-xs text-gray-500">No mapped ports.</span>';

    document.getElementById('docker-modal').classList.remove('hidden');
}

/**
 * Main function to fetch data from the agent and update the dashboard.
 */
async function fetchAndDisplayData() {
    // Prompt for password
    const password = prompt("Please enter the password to access the dashboard:");
    if (password === null) { // User clicked cancel
        return;
    }

    console.log('Fetching data from agent...');
    const refreshBtnIcon = document.querySelector('#refresh-btn i');
    refreshBtnIcon.classList.add('fa-spin'); // Add spin animation

    try {
        const response = await fetch(API_URL, {
            headers: {
                'X-Auth-Token': password
            }
        });
        
        if (response.status === 401) {
            throw new Error('Authentication failed. Incorrect password.');
        }

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        dashboardData = data; // Store data globally

        // Populate all sections with the new data
        populateDockerContainers(data.docker_containers);
        populateFirewallRules(data.firewall_rules);
        populateNginxProxies(data.nginx_proxies);

        // Update timestamp
        const now = new Date();
        document.getElementById('last-updated').textContent = `Updated: ${now.toLocaleTimeString()}`;
        console.log('Dashboard updated successfully.');

    } catch (error) {
        console.error("Failed to fetch or process dashboard data:", error);
        alert(error.message); // Show an alert with the error
        // Clear the dashboard on auth failure
        populateDockerContainers([]);
        populateFirewallRules();
        populateNginxProxies();
    } finally {
        refreshBtnIcon.classList.remove('fa-spin'); // Remove spin animation
    }
}


// --- Event Listeners ---

// Fetch data when the page first loads
document.addEventListener('DOMContentLoaded', fetchAndDisplayData);

// Handle refresh button click
document.getElementById('refresh-btn').addEventListener('click', fetchAndDisplayData);

// Handle clicks for showing the modal or closing it
document.addEventListener('click', function(e) {
    // Show modal when a container row is clicked
    const containerRow = e.target.closest('tr[data-container-id]');
    if (containerRow) {
        const containerId = containerRow.getAttribute('data-container-id');
        showDockerModal(containerId);
    }

    // Close modal when the close button or the overlay is clicked
    if (e.target.id === 'close-docker-modal' || e.target.closest('#close-docker-modal') || e.target.id === 'docker-modal') {
        document.getElementById('docker-modal').classList.add('hidden');
    }
});
