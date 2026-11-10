Feature: Reader modes and extraction
  As a signed-in user
  I want to read an article in different views
  So that I can read the cleanest version of it

  Background:
    Given I am signed in

  Scenario: Open in original mode by default
    When I open an article
    Then I see the content provided by the feed or the saved copy
    And the reader mode is "original"

  Scenario: Switch to the extracted view
    Given a subscription article with a URL and no extracted content yet
    When I switch to "extracted"
    Then the page is fetched using my extraction provider and the article content is extracted
    And the extracted content is stored on the article
    And the reader shows the extracted content

  Scenario: Reuse previously extracted content
    Given a subscription article already has extracted content
    When I switch to "extracted"
    Then the stored content is shown without fetching the page again

  Scenario: Extraction not possible without a URL
    Given a subscription article has no URL
    When I request extraction
    Then I see "Feed item has no original URL"
    And the reader stays in its previous mode

  Scenario: Extraction fails
    When extraction fails because the page cannot be fetched or has no article
    Then I see "Unable to fetch the article page", "Unable to extract article content" or "Extracted article content is empty"
    And the reader stays in its previous mode

  Scenario: View the original web page
    Given the article has a URL
    When I switch to "webpage"
    Then the original page is shown

  Scenario: Mode controls need a URL
    Given the article has no URL
    Then switching to "extracted" or "webpage" has no effect

  Scenario: Mode resets when another article is opened
    Given I am reading in "extracted" mode
    When I open a different article
    Then the reader mode is "original"

  Scenario: Article content is sanitized
    Given an article contains scripts or unsafe markup
    When I read it
    Then unsafe markup is removed
