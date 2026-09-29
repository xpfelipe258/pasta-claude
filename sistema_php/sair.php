<?php
require __DIR__ . '/inc/nucleo.php';
iniciar_sessao();
$_SESSION = [];
session_destroy();
header('Location: login.php');
