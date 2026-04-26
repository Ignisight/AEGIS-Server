FROM python:3.10

# Install system dependencies for OpenCV (Updated for newer Debian)
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create a home directory for deepface weights
RUN mkdir -p /.deepface/weights && chmod -R 777 /.deepface

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Set the deepface home environment variable to root to use the created folder
ENV DEEPFACE_HOME=/

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
