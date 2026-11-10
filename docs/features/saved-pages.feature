Feature: Saved pages (read later)
  As a signed-in user
  I want to save web pages to read later
  So that I can read their extracted content in one place

  Background:
    Given I am signed in

  Scenario: Add a link
    When I add the link "https://example.com/post"
    Then the page is fetched and its article content is extracted
    And it appears in my read-later list as unread
    And the saved-page unread count increases by 1

  Scenario Outline: Reject a link that is not a valid page URL
    When I add the link "<url>"
    Then I see the error "Page URL must use HTTP or HTTPS without credentials"
    And nothing is saved

    Examples:
      | url                              |
      | ftp://example.com/file           |
      | https://user:pw@example.com/post |

  Scenario: Add a link that is already saved
    Given "https://example.com/post" is already in my read-later list
    When I add the link "https://example.com/post" again
    Then I see "Page is already saved"
    And the existing entry is opened instead of creating a duplicate

  Scenario: Add a link whose page cannot be fetched
    When I add a link and the page cannot be fetched
    Then I see "Unable to fetch the article page"
    And nothing is saved

  Scenario: Add a link whose page has no readable content
    When I add a link and extraction finds no article content
    Then I see "Extracted article content is empty"
    And nothing is saved

  Scenario: Save a subscription article
    Given I am subscribed to a feed with an article
    When I save that article to read later
    Then a copy appears in my read-later list as unread
    And the copy uses the article's cached extracted content if present
    And otherwise its feed content if present
    And otherwise content extracted from its URL

  Scenario: Save a subscription article that has no content and no URL
    Given a feed article has neither content nor a URL
    When I save it to read later
    Then I see "Article content is empty"

  Scenario: Save a subscription article twice
    Given I already saved a feed article
    When I save the same article again
    Then I see "Page is already saved"

  Scenario: Saved copy is independent of the feed article
    Given I saved a feed article to read later
    When I mark the saved copy as read
    Then the original feed article stays unread

  Scenario Outline: Filter the read-later list
    Given I have read and unread saved pages
    When I filter by "<filter>"
    Then the list shows <shown> pages

    Examples:
      | filter | shown          |
      | all    | all            |
      | unread | only unread    |
      | read   | only read      |

  Scenario: Page through a long list
    Given I have more saved pages than fit in one page
    When I scroll to the end of the list
    Then the next page is loaded without repeating items

  Scenario: Reject an invalid pagination cursor
    When the list is requested with a malformed cursor
    Then I see "Invalid pagination cursor"

  Scenario: Refresh the list
    Given I have loaded part of my read-later list
    When I refresh
    Then the list is reloaded from the top through the last item I had loaded

  Scenario: Mark pages as read or unread
    Given I have saved pages
    When I mark selected pages as read
    Then they are shown as read
    And the saved-page unread count decreases accordingly
    When I mark them as unread
    Then they are shown as unread again

  Scenario: Mark all saved pages as read
    Given I have unread saved pages
    When I mark all read-later pages as read
    Then every saved page is read
    And the saved-page unread count is 0

  Scenario: Remove a saved page
    Given I have a saved page
    When I remove it
    Then it no longer appears in my read-later list

  Scenario: Saved pages are private
    Given another user has saved pages
    When I list my read-later pages
    Then I never see their pages
