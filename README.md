# README: Cloud-Sentinel
### Distributed Infrastructure Auditor & Security Gateway

**Cloud-Sentinel** is a microservices-based platform designed to automate AWS infrastructure health checks. It demonstrates the integration of a secure Node.js API, a Python-based background worker, and Redis-driven task distribution.

## 🏗 System Architecture
1.  **Auth Service (Node.js/Express):** Handles JWT authentication and acts as the API Gateway.
2.  **Task Broker (Redis):** Manages the communication between the API and the background workers.
3.  **Audit Worker (Python):** Uses `boto3` to perform asynchronous AWS infrastructure scans.
4.  **Database (PostgreSQL):** Stores user credentials and historical audit reports.

---

## 🛠 Tech Stack
*   **Backend:** Node.js (Express), Python
*   **Infrastructure:** AWS (Boto3), Docker, Nginx
*   **Data/Caching:** PostgreSQL, Redis
*   **Security:** JWT, Bcrypt, Web Security principles

---

## 🚀 Implementation Roadmap (For LLM Execution)

### Step 1: The Dockerized Foundation
*   **Task:** Setup a `docker-compose.yml` file.
*   **Requirement:** Define five services: `gateway` (Node), `worker` (Python), `redis`, `db` (Postgres), and `nginx`.
*   **Goal:** Ensure all containers can communicate via a shared bridge network.

### Step 2: The Auth Gateway (Node.js)
*   **Task:** Develop a REST API for User Registration and Login.
*   **Requirement:** Use Bcrypt for password hashing and generate JWTs for session management.
*   **Endpoint:** `POST /api/audit` — This endpoint should verify the JWT, then push a "Scan Task" message into a Redis list instead of performing the scan itself.

### Step 3: The Distributed Worker (Python)
*   **Task:** Create a `worker.py` script that listens to the Redis list.
*   **Requirement:** When a message is received, trigger a function using the `boto3` library.
*   **Audit Logic:** 
    1.  Check for any unencrypted S3 buckets.
    2.  List all running EC2 instances and their "State."
    3.  Check if MFA is enabled for the current IAM user.

### Step 4: Data Persistence & Reporting
*   **Task:** Save the JSON results of the AWS scan back into the PostgreSQL database.
*   **Requirement:** Link each report to the `user_id` who requested it.
*   **Goal:** Show high-level **Data Modeling** and **Log Analysis** skills as practiced in your Deloitte simulation.

### Step 5: Nginx Reverse Proxy
*   **Task:** Configure Nginx to route traffic to the Node.js gateway.
*   **Requirement:** Hide the Express server behind the proxy and set up a basic rate-limiter to prevent API abuse.

---

## 📝 Prompt to give your LLM:
> "I am building **Cloud-Sentinel**, a distributed AWS auditor. I need you to help me code the **Step 2: Auth Gateway**. Provide the `server.js` code using Express.js that connects to a PostgreSQL database and uses Redis to push a task called 'start_audit'. Ensure the code follows professional **Web Security** standards."

---

### Why this project fits your Resume:
Building this validates your technical skills in **Docker**, **AWS**, and **Node.js**. It also proves you can handle **Microservices** and **Log Analysis**, which are key differentiators from projects focused purely on frontend or basic Android development.
