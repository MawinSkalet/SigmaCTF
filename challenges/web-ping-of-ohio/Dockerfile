FROM php:8.2-apache-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends iputils-ping coreutils && rm -rf /var/lib/apt/lists/* \
    && sed -i 's/Listen 80/Listen 8080/' /etc/apache2/ports.conf \
    && sed -i 's/:80>/:8080>/' /etc/apache2/sites-available/000-default.conf \
    && printf '\nServerName localhost\nPidFile /tmp/apache.pid\nDefaultRuntimeDir /tmp\nMutex file:/tmp default\n' >> /etc/apache2/apache2.conf \
    && sed -i 's/StartServers.*/StartServers 1/;s/MinSpareServers.*/MinSpareServers 1/;s/MaxSpareServers.*/MaxSpareServers 2/;s/MaxRequestWorkers.*/MaxRequestWorkers 4/' /etc/apache2/mods-available/mpm_prefork.conf
COPY index.php /var/www/html/index.php
COPY run.sh /run.sh
RUN chmod 555 /run.sh
ENV APACHE_RUN_USER=www-data APACHE_RUN_GROUP=www-data APACHE_RUN_DIR=/tmp APACHE_LOCK_DIR=/tmp APACHE_PID_FILE=/tmp/apache.pid
USER 10001:10001
EXPOSE 8080
CMD ["/run.sh"]
