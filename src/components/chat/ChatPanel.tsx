// src/components/chat/ChatPanel.tsx
import { t } from '@/i18n';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '../../hooks/useAuth';
import { useChat } from '../../hooks/useChat';
import { ChevronDownIcon } from '../common/Icons';
import ChatMessage from './ChatMessage';

interface ChatPanelProps {
  className?: string;
}

const ChatBubbleIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
  </svg>
);

const PANEL_WIDTH = 300;
const PANEL_HEIGHT = 420;
const BUBBLE_SIZE = 48;

const ChatPanel: React.FC<ChatPanelProps> = () => {
  const { user } = useAuth();
  const { messages, isConnected, sendMessage } = useChat();
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [pos, setPos] = useState(() => ({
    x: window.innerWidth - BUBBLE_SIZE - 20,
    y: window.innerHeight - BUBBLE_SIZE - 52,
  }));
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ mouseX: number; mouseY: number; elemX: number; elemY: number } | null>(null);
  const hasDragged = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messagesEndRef.current && isOpen) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragRef.current = { mouseX: e.clientX, mouseY: e.clientY, elemX: pos.x, elemY: pos.y };
    hasDragged.current = false;
    setIsDragging(true);
    e.preventDefault();
  }, [pos]);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.mouseX;
      const dy = e.clientY - dragRef.current.mouseY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasDragged.current = true;
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - BUBBLE_SIZE, dragRef.current.elemX + dx)),
        y: Math.max(0, Math.min(window.innerHeight - BUBBLE_SIZE, dragRef.current.elemY + dy)),
      });
    };
    const onUp = () => { setIsDragging(false); dragRef.current = null; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, [isDragging]);

  const handleBubbleClick = () => {
    if (!hasDragged.current) setIsOpen((v) => !v);
  };

  const handleSendMessage = () => {
    if (!inputValue.trim()) return;
    sendMessage(inputValue);
    setInputValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Position the panel relative to bubble, keeping it on-screen
  const panelLeft = Math.max(8, Math.min(window.innerWidth - PANEL_WIDTH - 8,
    pos.x + BUBBLE_SIZE / 2 - PANEL_WIDTH / 2));
  const panelTop = pos.y - PANEL_HEIGHT - 8 < 8
    ? pos.y + BUBBLE_SIZE + 8
    : pos.y - PANEL_HEIGHT - 8;

  return (
    <>
      {/* Floating bubble */}
      <div
        className={`chat-bubble${isDragging ? ' dragging' : ''}${isOpen ? ' open' : ''}`}
        style={{ left: pos.x, top: pos.y, cursor: isDragging ? 'grabbing' : 'grab' }}
        onMouseDown={handleMouseDown}
        onClick={handleBubbleClick}
        title={t('Project Chat')}
      >
        <ChatBubbleIcon />
        {messages.length > 0 && (
          <span className="bubble-badge">{messages.length > 9 ? '9+' : messages.length}</span>
        )}
      </div>

      {/* Chat panel */}
      {isOpen && (
        <div
          className="chat-panel-floating"
          style={{ left: panelLeft, top: panelTop, width: PANEL_WIDTH }}
        >
          <div className="chat-panel-header">
            <span className="chat-panel-title">{t('Project Chat')}</span>
            <div className="chat-panel-status">
              {isConnected && <div className="connection-indicator connected" title={t('Connected')} />}
              <button className="collapse-toggle" onClick={() => setIsOpen(false)}>
                <ChevronDownIcon />
              </button>
            </div>
          </div>
          <div className="chat-panel-content">
            <div className="chat-panel-messages">
              {messages.length === 0 ? (
                <div className="empty-chat">
                  <p>{t('Welcome to the project chat!')}</p>
                  <p>{t('Start a conversation with your collaborators.')}</p>
                </div>
              ) : (
                messages.map((message) => (
                  <ChatMessage
                    key={message.id}
                    message={message}
                    isOwnMessage={message.user === user?.username}
                  />
                ))
              )}
              <div ref={messagesEndRef} />
            </div>
            <div className="chat-panel-input-container">
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('Type a message...')}
                className="chat-panel-input"
                disabled={!isConnected}
                rows={2}
              />
              <button
                onClick={handleSendMessage}
                disabled={!inputValue.trim() || !isConnected}
                className="chat-panel-send-button"
              >
                {t('Send')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ChatPanel;
