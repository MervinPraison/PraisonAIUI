import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Eye, AlertCircle } from 'lucide-react';
import { ChatMessages } from '../chat/ChatMessages';
import { Button } from '../components/ui/button';

interface SharedThreadData {
  thread_id: string;
  session: {
    id: string;
    title: string;
    created_at: string;
  };
  messages: Array<{
    id: string;
    role: string;
    content: string;
    timestamp: string;
    toolCalls?: any[];
  }>;
  read_only: boolean;
}

export function SharedThread() {
  const { token } = useParams<{ token: string }>();
  const [threadData, setThreadData] = useState<SharedThreadData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const fetchSharedThread = async () => {
      if (!token) {
        setError('Invalid share link');
        setIsLoading(false);
        return;
      }

      try {
        const response = await fetch(`/shared/${token}`, {
          headers: {
            'Accept': 'application/json',
          },
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to load shared thread');
        }

        const data = await response.json();
        setThreadData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load shared thread');
      } finally {
        setIsLoading(false);
      }
    };

    fetchSharedThread();
  }, [token]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <div className="text-sm text-gray-600">Loading shared conversation...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-md w-full bg-white rounded-lg shadow-sm border border-gray-200 p-6 text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-gray-900 mb-2">
            Unable to Load Shared Thread
          </h2>
          <p className="text-sm text-gray-600 mb-4">{error}</p>
          <Button 
            onClick={() => window.location.href = '/'}
            variant="outline"
          >
            Go Home
          </Button>
        </div>
      </div>
    );
  }

  if (!threadData) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Eye className="h-5 w-5 text-gray-500" />
              <div>
                <h1 className="text-lg font-semibold text-gray-900">
                  {threadData.session.title || 'Shared Conversation'}
                </h1>
                <p className="text-sm text-gray-500">
                  Read-only view • Created {new Date(threadData.session.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>
            
            <Button 
              onClick={() => window.location.href = '/'}
              variant="outline"
              size="sm"
            >
              Start New Chat
            </Button>
          </div>
        </div>
      </header>

      {/* Messages */}
      <main className="max-w-4xl mx-auto px-4 py-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {threadData.messages.length > 0 ? (
            <div className="divide-y divide-gray-100">
              <ChatMessages 
                messages={threadData.messages}
                sessionId={threadData.thread_id}
                isSharedView={true}
              />
            </div>
          ) : (
            <div className="p-8 text-center">
              <div className="text-gray-500">
                <Eye className="h-8 w-8 mx-auto mb-2" />
                <p className="text-sm">This conversation is empty.</p>
              </div>
            </div>
          )}
        </div>
        
        {/* Read-only notice */}
        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
          <div className="flex items-center space-x-2 text-sm text-blue-800">
            <Eye className="h-4 w-4" />
            <span>
              You're viewing a read-only shared conversation. 
              You can't reply or interact with this chat.
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}